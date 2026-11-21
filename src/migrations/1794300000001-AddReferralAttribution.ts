import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferralAttribution1794300000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION generate_referral_code() RETURNS varchar(16)
      LANGUAGE sql VOLATILE
      AS $$ SELECT substr(md5(gen_random_uuid()::text), 1, 16)::varchar(16) $$;
      ALTER TABLE "users"
        ADD COLUMN "referralCode" varchar(16) NOT NULL
          DEFAULT generate_referral_code(),
        ADD COLUMN "referredBy" uuid,
        ADD CONSTRAINT "FK_users_referrer" FOREIGN KEY ("referredBy")
          REFERENCES "users" ("id") ON DELETE SET NULL;
      CREATE UNIQUE INDEX "IDX_users_referral_code" ON "users" ("referralCode");
      CREATE INDEX "IDX_users_referred_by" ON "users" ("referredBy");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "FK_users_referrer",
        DROP COLUMN "referredBy",
        DROP COLUMN "referralCode";
      DROP FUNCTION generate_referral_code();
    `);
  }
}
