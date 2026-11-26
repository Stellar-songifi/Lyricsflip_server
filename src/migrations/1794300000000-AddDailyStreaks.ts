import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyStreaks1794300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "achievements" (
        "code" varchar(50) CONSTRAINT "PK_achievements" PRIMARY KEY,
        "name" text NOT NULL,
        "description" text NOT NULL
      );
      CREATE TABLE "user_achievements" (
        "userId" uuid NOT NULL,
        "achievementCode" varchar(50) NOT NULL,
        "unlockedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_achievements" PRIMARY KEY ("userId", "achievementCode"),
        CONSTRAINT "FK_user_achievements_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_achievements_code" FOREIGN KEY ("achievementCode")
          REFERENCES "achievements" ("code") ON DELETE CASCADE
      );
      INSERT INTO "achievements" ("code", "name", "description") VALUES
        ('first_win', 'First Win', 'Win your first wager.'),
        ('perfect_guess', 'Perfect Guess', 'Answer your first question correctly.'),
        ('streak_5', 'On Fire', 'Reach a streak of 5 correct answers.'),
        ('streak_10', 'Unstoppable', 'Reach a streak of 10 correct answers.'),
        ('speed_demon', 'Speed Demon', 'Answer correctly in under 3 seconds.'),
        ('daily_streak_7', '7-Day Daily Challenge Streak', 'Play the daily challenge on 7 consecutive UTC days.'),
        ('daily_streak_30', '30-Day Daily Challenge Streak', 'Play the daily challenge on 30 consecutive UTC days.'),
        ('daily_streak_100', '100-Day Daily Challenge Streak', 'Play the daily challenge on 100 consecutive UTC days.')
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD "dailyStreak" integer NOT NULL DEFAULT 0,
        ADD "bestDailyStreak" integer NOT NULL DEFAULT 0,
        ADD "lastDailyAttemptDate" date
    `);

    await queryRunner.query(`
      WITH played_days AS (
        SELECT DISTINCT "userId", "challengeDate" FROM "daily_challenge_attempts"
      ), grouped_days AS (
        SELECT *,
          "challengeDate" - (row_number() OVER (
            PARTITION BY "userId" ORDER BY "challengeDate"
          ))::integer AS streak_group
        FROM played_days
      ), streaks AS (
        SELECT "userId", max("challengeDate") AS last_day, count(*)::integer AS length
        FROM grouped_days GROUP BY "userId", streak_group
      ), latest AS (
        SELECT DISTINCT ON ("userId") *,
          max(length) OVER (PARTITION BY "userId") AS best
        FROM streaks ORDER BY "userId", last_day DESC
      )
      UPDATE "users" AS player
      SET "dailyStreak" = latest.length,
          "bestDailyStreak" = latest.best,
          "lastDailyAttemptDate" = latest.last_day
      FROM latest WHERE player.id = latest."userId"
    `);

    await queryRunner.query(`
      INSERT INTO "user_achievements" ("userId", "achievementCode")
      SELECT player.id, milestone.code
      FROM "users" player
      CROSS JOIN (VALUES (7, 'daily_streak_7'), (30, 'daily_streak_30'),
        (100, 'daily_streak_100')) AS milestone(days, code)
      WHERE player."bestDailyStreak" >= milestone.days
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "user_achievements"');
    await queryRunner.query('DROP TABLE "achievements"');
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "lastDailyAttemptDate",
        DROP COLUMN "bestDailyStreak",
        DROP COLUMN "dailyStreak"
    `);
  }
}
