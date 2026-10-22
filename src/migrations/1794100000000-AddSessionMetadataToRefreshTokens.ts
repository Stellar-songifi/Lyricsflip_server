import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Session management (issue R2-94): each refresh token records the client
 * that uses it, so GET /auth/sessions can list devices. The IP is stored
 * truncated to its network (see truncateIp), per the retention policy in
 * docs/DATA_ARCHIVING.md.
 *
 * Also indexes expiresAt and revokedAt for the daily SessionCleanupJob.
 */
export class AddSessionMetadataToRefreshTokens1794100000000
  implements MigrationInterface
{
  name = 'AddSessionMetadataToRefreshTokens1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN "userAgent" character varying(255),
        ADD COLUMN "ip" character varying(64),
        ADD COLUMN "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "deviceName" character varying(100)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_expiresAt" ON "refresh_tokens" ("expiresAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_revokedAt" ON "refresh_tokens" ("revokedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_revokedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_expiresAt"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        DROP COLUMN "deviceName",
        DROP COLUMN "lastUsedAt",
        DROP COLUMN "ip",
        DROP COLUMN "userAgent"
    `);
  }
}
