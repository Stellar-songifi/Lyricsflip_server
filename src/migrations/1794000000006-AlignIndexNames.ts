import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index drift that `migration:check` reports on a freshly migrated database:
 *
 * - `audit_logs`: CreateAuditLogsTable named its indexes by hand; they are
 *   renamed to the names TypeORM derives for the entity's `@Index()`es;
 * - `game_history`: the entity's `(createdAt, playerId)` index was never
 *   created;
 * - `game_rounds`: the entity's `IDX_game_rounds_user_issued` index was never
 *   created.
 */
export class AlignIndexNames1794000000006 implements MigrationInterface {
  name = 'AlignIndexNames1794000000006';

  private readonly auditLogIndexes: [string, string, string][] = [
    ['IDX_audit_logs_actor_id', 'IDX_2dc33f7f3c22e2e7badafca1d1', 'actorId'],
    ['IDX_audit_logs_action', 'IDX_cee5459245f652b75eb2759b4c', 'action'],
    ['IDX_audit_logs_target_id', 'IDX_fcfb9137823075fb3162b82f73', 'targetId'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to, column] of this.auditLogIndexes) {
      await this.renameIndex(queryRunner, from, to);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "${to}" ON "audit_logs" ("${column}") `,
      );
    }

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_5ec199dfd58606da0887b7018f" ON "game_history" ("createdAt", "playerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_game_rounds_user_issued" ON "game_rounds" ("userId", "issuedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_game_rounds_user_issued"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_5ec199dfd58606da0887b7018f"`,
    );
    for (const [from, to] of this.auditLogIndexes) {
      await this.renameIndex(queryRunner, to, from);
    }
  }

  /** Renames an index when the old name exists and the new one does not. */
  private async renameIndex(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public."${from}"') IS NOT NULL
          AND to_regclass('public."${to}"') IS NULL THEN
          ALTER INDEX "public"."${from}" RENAME TO "${to}";
        END IF;
      END $$
    `);
  }
}
