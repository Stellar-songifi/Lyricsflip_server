import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the deadline past which an unfinished `AWAITING_STAKES` wager is
 * refunded automatically by `WagerRefundJob`.
 *
 * Nullable so existing rows — already `STAKED` or resolved by the time this
 * runs — are left alone; the job only ever acts on rows with a deadline set.
 */
export class AddStakeDeadlineToWagers1791000000000
  implements MigrationInterface
{
  name = 'AddStakeDeadlineToWagers1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers" ADD COLUMN "stakeDeadline" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers" DROP COLUMN "stakeDeadline"
    `);
  }
}
