import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `daily_date` to `game_rounds` so rounds issued for the daily challenge
 * can be looked up by `(user_id, daily_date, lyric_id)` and reused across
 * requests within the same day (R3-51).
 *
 * The column is nullable: existing solo/multiplayer rounds have no daily date.
 * A partial unique index enforces one open round per user per lyric per day,
 * so a race between simultaneous GET /challenges/daily requests cannot create
 * duplicate rounds for the same lyric.
 */
export class AddDailyDateToGameRounds1794300000000 implements MigrationInterface {
  name = 'AddDailyDateToGameRounds1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_rounds"
        ADD COLUMN "daily_date" date NULL
    `);

    // Index for the daily-round lookup (userId, dailyDate, lyricId).
    await queryRunner.query(`
      CREATE INDEX "IDX_game_rounds_daily_date"
        ON "game_rounds" ("user_id", "daily_date", "lyric_id")
        WHERE "daily_date" IS NOT NULL
    `);

    // Prevents two open rounds for the same user/day/lyric from being created
    // in a race. Closed rounds (closedAt IS NOT NULL) are excluded so the
    // history of past attempts is kept.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_game_rounds_daily_open"
        ON "game_rounds" ("user_id", "daily_date", "lyric_id")
        WHERE "daily_date" IS NOT NULL AND "closed_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_game_rounds_daily_open"`);
    await queryRunner.query(`DROP INDEX "IDX_game_rounds_daily_date"`);
    await queryRunner.query(`
      ALTER TABLE "game_rounds"
        DROP COLUMN "daily_date"
    `);
  }
}
