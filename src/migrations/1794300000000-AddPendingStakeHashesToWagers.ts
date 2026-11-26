import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps the hash of a submitted stake that did not confirm apart from the
 * confirmed stake hash, so a failed stake no longer makes a player look staked.
 */
export class AddPendingStakeHashesToWagers1794300000000
  implements MigrationInterface
{
  name = 'AddPendingStakeHashesToWagers1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ADD COLUMN "playerAPendingStakeHash" character varying(128),
      ADD COLUMN "playerBPendingStakeHash" character varying(128)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers"
      DROP COLUMN "playerBPendingStakeHash",
      DROP COLUMN "playerAPendingStakeHash"
    `);
  }
}
