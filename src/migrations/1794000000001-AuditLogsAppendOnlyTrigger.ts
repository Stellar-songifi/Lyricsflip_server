import { MigrationInterface, QueryRunner } from 'typeorm';

/** Database-level append-only protection for audit_logs. */
export class AuditLogsAppendOnlyTrigger1794000000005
  implements MigrationInterface
{
  name = 'AuditLogsAppendOnlyTrigger1794000000005';
/**
 * One-off scrub of plaintext password-like fields from existing audit_logs rows.
 *
 * Background: AuditInterceptor previously used a shallow, exact-match sanitizer
 * that only redacted top-level keys named literally `password`, `token`,
 * `secret`, `transaction` or `authorization`. Bodies such as
 * `{ currentPassword, newPassword }` (POST /auth/change-password) were therefore
 * persisted in plaintext in the append-only `audit_logs` table.
 *
 * The `audit_logs_append_only` trigger (see migration 1794000000001) blocks all
 * UPDATE/DELETE on `audit_logs`. This migration performs a documented, one-off
 * bypass: it drops the trigger, scrubs the offending keys from `payload`, and
 * recreates the trigger. The bypass is scoped to this migration only; the
 * append-only guarantee is restored before the migration completes.
 *
 * NOTE: `down()` is intentionally a no-op — scrubbed plaintext secrets cannot
 * (and must not) be restored.
 */
export class ScrubAuditLogPasswords1794000000002
  implements MigrationInterface
{
  name = 'ScrubAuditLogPasswords1794000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- One-off bypass of the append-only trigger -------------------------
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs"`,
    );

    try {
      // --- Scrub password-like keys from existing payloads ---------------
      //
      // Recursively walks the JSON payload and replaces the value of any key
      // matching the redact patterns (case-insensitive) with
      // '***REDACTED***'. Mirrors src/common/utils/redact.util.ts:
      //   /pass(word)?/, /token/, /secret/, /xdr|transaction/,
      //   /authorization/, /seed/
      await queryRunner.query(`
        WITH RECURSIVE scrub(value, path, root_id) AS (
          SELECT
            al.payload,
            ARRAY[]::text[],
            al.id
          FROM "audit_logs" al
          WHERE al.payload IS NOT NULL

          UNION ALL

          SELECT
            CASE
              WHEN jsonb_typeof(s.value) = 'object' THEN (
                SELECT jsonb_object_agg(
                  key,
                  CASE
                    WHEN key ~* '(pass(word)?|token|secret|xdr|transaction|authorization|seed)'
                      THEN to_jsonb('***REDACTED***'::text)
                    ELSE val
                  END
                )
                FROM jsonb_each(s.value) AS e(key, val)
              )
              WHEN jsonb_typeof(s.value) = 'array' THEN (
                SELECT jsonb_agg(
                  CASE
                    WHEN jsonb_typeof(elem) IN ('object', 'array') THEN elem
                    ELSE elem
                  END
                )
                FROM jsonb_array_elements(s.value) AS elem
              )
              ELSE s.value
            END,
            s.path,
            s.root_id
          FROM scrub s
          WHERE jsonb_typeof(s.value) IN ('object', 'array')
        )
        SELECT 1
      `);

      // The recursive CTE above is illustrative; the authoritative scrub is
      // performed by the function below, which rewrites payloads in place.
      await queryRunner.query(`
        CREATE OR REPLACE FUNCTION audit_logs_scrub_passwords(input jsonb)
        RETURNS jsonb AS $$
        DECLARE
          result jsonb;
          rec RECORD;
          elem jsonb;
          arr jsonb;
        BEGIN
          IF input IS NULL THEN
            RETURN NULL;
          END IF;

          IF jsonb_typeof(input) = 'object' THEN
            result := '{}'::jsonb;
            FOR rec IN SELECT key, value FROM jsonb_each(input) LOOP
              IF rec.key ~* '(pass(word)?|token|secret|xdr|transaction|authorization|seed)' THEN
                result := result || jsonb_build_object(rec.key, '***REDACTED***'::text);
              ELSE
                result := result || jsonb_build_object(
                  rec.key,
                  audit_logs_scrub_passwords(rec.value)
                );
              END IF;
            END LOOP;
            RETURN result;
          ELSIF jsonb_typeof(input) = 'array' THEN
            arr := '[]'::jsonb;
            FOR elem IN SELECT value FROM jsonb_array_elements(input) LOOP
              arr := arr || jsonb_build_array(audit_logs_scrub_passwords(elem));
            END LOOP;
            RETURN arr;
          ELSE
            RETURN input;
          END IF;
        END;
        $$ LANGUAGE plpgsql
      `);

      await queryRunner.query(`
        UPDATE "audit_logs"
        SET payload = audit_logs_scrub_passwords(payload)
        WHERE payload IS NOT NULL
          AND payload::text ~* '(pass(word)?|token|secret|xdr|transaction|authorization|seed)'
      `);

      await queryRunner.query(
        `DROP FUNCTION IF EXISTS audit_logs_scrub_passwords(jsonb)`,
      );
    } finally {
      // --- Restore the append-only guarantee -----------------------------
      await queryRunner.query(`
        CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs is append-only';
        END;
        $$ LANGUAGE plpgsql
      `);
      await queryRunner.query(`
        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON "audit_logs"
        FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation()
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally a no-op: scrubbed plaintext secrets cannot be restored.
  }
}