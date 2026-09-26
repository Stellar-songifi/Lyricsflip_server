import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lyric difficulty calibration constraints (issue #175).
 *
 * Previously `difficulty` defaulted to 0, which is outside the documented
 * 1–5 range.  This migration:
 *
 *   1. Updates all existing rows where difficulty = 0 to the neutral midpoint
 *      value of 3, so every lyric immediately has a valid difficulty.
 *   2. Changes the column default from 0 to 3.
 *   3. Adds a CHECK (difficulty BETWEEN 1 AND 5) constraint so the database
 *      enforces the range regardless of application-level validation.
 *
 * The constraint is named so the down() migration can drop it by name.
 */
export class AddDifficultyConstraintAndDefault1793000000000
  implements MigrationInterface
{
  name = 'AddDifficultyConstraintAndDefault1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill rows that have the old default of 0 (i.e. "unset").
    await queryRunner.query(`
      UPDATE "lyrics"
      SET "difficulty" = 3
      WHERE "difficulty" = 0
    `);

    // 2. Change the column default so new lyrics start at 3.
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        ALTER COLUMN "difficulty" SET DEFAULT 3
    `);

    // 3. Enforce the 1–5 range at the database level.
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        ADD CONSTRAINT "CHK_lyrics_difficulty"
          CHECK ("difficulty" BETWEEN 1 AND 5)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 3. Remove the check constraint.
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        DROP CONSTRAINT "CHK_lyrics_difficulty"
    `);

    // 2. Revert the column default to the original 0.
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        ALTER COLUMN "difficulty" SET DEFAULT 0
    `);

    // 1. We deliberately do not revert the backfilled data because reverting
    //    rows from 3 back to 0 would discard any difficulty values that were
    //    set legitimately (either manually or by the calibration job).
  }
}
