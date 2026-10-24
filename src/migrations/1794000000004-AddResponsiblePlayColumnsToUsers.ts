import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the responsible-play columns the `User` entity gained without a
 * migration: the personal daily stake limit, when a raised limit takes
 * effect, and the self-exclusion end date. All nullable, meaning "no limit"
 * and "not excluded", so existing users need no backfill.
 *
 * Also creates the case-insensitive unique index on `username` that
 * AddCaseInsensitiveUniqueIndexToUsers skips on an empty database, where
 * `username` did not exist yet when it ran.
 */
export class AddResponsiblePlayColumnsToUsers1794000000004
  implements MigrationInterface
{
  name = 'AddResponsiblePlayColumnsToUsers1794000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "dailyStakeLimit" bigint,
        ADD COLUMN IF NOT EXISTS "dailyStakeLimitEffectiveAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "selfExclusionEndsAt" TIMESTAMP
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_username_lower" ON "users" (LOWER("username"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IDX_users_username_lower is left in place: it belongs to
    // AddCaseInsensitiveUniqueIndexToUsers on databases where that created it.
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "selfExclusionEndsAt",
        DROP COLUMN IF EXISTS "dailyStakeLimitEffectiveAt",
        DROP COLUMN IF EXISTS "dailyStakeLimit"
    `);
  }
}
