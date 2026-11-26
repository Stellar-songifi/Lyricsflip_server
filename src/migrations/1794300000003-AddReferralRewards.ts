import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferralRewards1794300000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE referral_rounds (
        "roundId" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "lyricId" integer NOT NULL,
        "correctInTime" boolean NOT NULL,
        "elapsedMs" integer NOT NULL,
        "readingFloorMs" integer NOT NULL
      );
      CREATE INDEX "IDX_referral_rounds_user" ON referral_rounds ("userId");
      CREATE TABLE referral_rewards (
        "referredId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        "referrerId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "awardedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_referral_rewards_referrer" ON referral_rewards ("referrerId");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE referral_rewards, referral_rounds');
  }
}
