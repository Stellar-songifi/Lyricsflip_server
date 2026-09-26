import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Timed rounds, hints and the daily challenge.
 *
 * game_rounds gains the per-round answer window, the hints taken and the
 * session the round was played in. The daily challenge stores each day's lyric
 * set and one attempt per user, day and lyric.
 */
export class AddTimedRoundsHintsAndDailyChallenges1792000000000
  implements MigrationInterface
{
  name = 'AddTimedRoundsHintsAndDailyChallenges1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_rounds"
        ADD COLUMN "answerWindowSeconds" integer NOT NULL DEFAULT 20,
        ADD COLUMN "hintsUsed" integer NOT NULL DEFAULT 0,
        ADD COLUMN "sessionId" uuid
    `);

    await queryRunner.query(`
      CREATE TABLE "daily_challenges" (
        "date" date NOT NULL,
        "lyricIds" integer array NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_challenges" PRIMARY KEY ("date")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "daily_challenge_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "challengeDate" date NOT NULL,
        "lyricId" integer NOT NULL,
        "guessType" character varying(16) NOT NULL,
        "isCorrect" boolean NOT NULL,
        "points" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_challenge_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_attempt_user_day_lyric"
          UNIQUE ("userId", "challengeDate", "lyricId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_attempt_day"
        ON "daily_challenge_attempts" ("challengeDate")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_daily_attempt_day"`);
    await queryRunner.query(`DROP TABLE "daily_challenge_attempts"`);
    await queryRunner.query(`DROP TABLE "daily_challenges"`);
    await queryRunner.query(`
      ALTER TABLE "game_rounds"
        DROP COLUMN "sessionId",
        DROP COLUMN "hintsUsed",
        DROP COLUMN "answerWindowSeconds"
    `);
  }
}
