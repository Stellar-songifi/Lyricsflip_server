import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Existing "email" and "username" columns already carry a plain unique
 * constraint, which is case-sensitive: "Alice@Example.com" and
 * "alice@example.com" could previously coexist. This adds functional unique
 * indexes on LOWER(email) / LOWER(username) so duplicates that differ only
 * by case are rejected at the database level, on top of the application-side
 * normalization in the signup/login DTOs.
 */
export class AddCaseInsensitiveUniqueIndexToUsers1758800000000
  implements MigrationInterface
{
  name = 'AddCaseInsensitiveUniqueIndexToUsers1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_email_lower" ON "users" (LOWER("email"))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_username_lower" ON "users" (LOWER("username"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_username_lower"`);
    await queryRunner.query(`DROP INDEX "IDX_users_email_lower"`);
  }
}
