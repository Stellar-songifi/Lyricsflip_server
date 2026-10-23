import { MigrationInterface, QueryRunner } from 'typeorm';

/** Database-level append-only protection for audit_logs. */
export class AuditLogsAppendOnlyTrigger1794000000001
  implements MigrationInterface
{
  name = 'AuditLogsAppendOnlyTrigger1794000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_block_mutation()`);
  }
}
