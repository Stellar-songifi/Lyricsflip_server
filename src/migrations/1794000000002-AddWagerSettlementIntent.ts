import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the settlement intent recorded when a wager enters `settling`
 * (8acd7ff; issue R2-34): which kind of settlement it was, and the winner a
 * payout intended to pay.
 *
 * No backfill: both columns are nullable, and a wager settled before this
 * migration has no recorded intent to restore, so null means "not recorded".
 */
export class AddWagerSettlementIntent1794000000002
  implements MigrationInterface
{
  name = 'AddWagerSettlementIntent1794000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = 'settlement_kind_enum'
        ) THEN
          CREATE TYPE "public"."settlement_kind_enum" AS ENUM('payout', 'refund');
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "wagers"
        ADD COLUMN IF NOT EXISTS "settlementKind" "public"."settlement_kind_enum",
        ADD COLUMN IF NOT EXISTS "intendedWinnerId" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagers"
        DROP COLUMN IF EXISTS "intendedWinnerId",
        DROP COLUMN IF EXISTS "settlementKind"
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."settlement_kind_enum"`,
    );
  }
}
