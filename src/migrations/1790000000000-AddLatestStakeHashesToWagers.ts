import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks the hash of the most recently built stake transaction per player.
 *
 * A stake transaction expires — its timeout runs out, or the player's account
 * sequence number moves — well before a wager does. Without a record of which
 * hash is current, `confirmStake` cannot tell a stale, previously-issued
 * transaction from the one a fresh request just built.
 */
export class AddLatestStakeHashesToWagers1790000000000
  implements MigrationInterface
{
  name = 'AddLatestStakeHashesToWagers1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ADD COLUMN "playerALatestStakeHash" character varying(128),
      ADD COLUMN "playerBLatestStakeHash" character varying(128)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers"
      DROP COLUMN "playerBLatestStakeHash",
      DROP COLUMN "playerALatestStakeHash"
    `);
  }
}
