import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archive table for game_history rows past their retention period (issue
 * R2-95). RetentionJob moves rows here with INSERT ... SELECT *, so the
 * table is created LIKE game_history to keep the column order identical.
 * Any column later added to game_history must be added here too.
 *
 * Only the playerId index is kept: the archive is read for data export and
 * erasure by player, not for gameplay.
 */
export class CreateGameHistoryArchive1794200000000 implements MigrationInterface {
  name = 'CreateGameHistoryArchive1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_history_archive"
        (LIKE "game_history" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
    `);
    await queryRunner.query(`
      ALTER TABLE "game_history_archive"
        ADD CONSTRAINT "PK_game_history_archive" PRIMARY KEY ("id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_game_history_archive_playerId"
        ON "game_history_archive" ("playerId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Put archived rows back so rolling back loses no history.
    await queryRunner.query(`
      INSERT INTO "game_history" SELECT * FROM "game_history_archive"
    `);
    await queryRunner.query(`DROP TABLE "game_history_archive"`);
  }
}
