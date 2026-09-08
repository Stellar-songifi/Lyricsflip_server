import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves wagering from mock integer token counts to Stellar-backed escrow.
 *
 * Three things change shape:
 *
 * 1. **Amounts become stroops.** LYRIC has 7 decimals, so every money column
 *    is widened to `bigint` and existing whole-token values are multiplied by
 *    10^7. An `integer` column would overflow at ~214 tokens once scaled.
 * 2. **Wagers gain settlement bookkeeping** — which backend settled them, the
 *    transaction hashes for the escrow, both stakes and the payout, and the
 *    ledger the payout landed in. Without these a crash mid-settlement leaves
 *    an untracked transaction that has already moved funds.
 * 3. **Users gain a linked Stellar account**, proved by a SEP-10 signature.
 *
 * The scaling is exact in both directions for values that were whole tokens,
 * which is everything the mock backend could produce. `down()` divides back and
 * therefore truncates any sub-token remainder created after this migration ran;
 * that is unavoidable when narrowing to a whole-token integer column.
 */
export class MigrateWagersToStellarEscrow1788480000000
  implements MigrationInterface
{
  name = 'MigrateWagersToStellarEscrow1788480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- users: linked Stellar account ----
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "stellarAddress" character varying(56),
      ADD COLUMN "stellarAddressVerifiedAt" TIMESTAMP
    `);

    // Unique rather than a plain index: two accounts sharing a payout address
    // would make a payout unattributable. Postgres treats NULLs as distinct, so
    // users who have not linked a wallet are unaffected.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_stellar_address"
      ON "users" ("stellarAddress")
    `);

    // ---- users: mockTokenBalance (whole tokens) -> mockBalance (stroops) ----
    await queryRunner.query(`
      ALTER TABLE "users" RENAME COLUMN "mockTokenBalance" TO "mockBalance"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "mockBalance" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "mockBalance" TYPE bigint
      USING "mockBalance"::bigint * 10000000
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "mockBalance" SET DEFAULT 1000000000
    `);

    // ---- wagers: amounts -> stroops ----
    await queryRunner.query(`
      ALTER TABLE "wagers" RENAME COLUMN "amount" TO "stakeStroops"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "stakeStroops" TYPE bigint
      USING "stakeStroops"::bigint * 10000000
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" RENAME COLUMN "totalPot" TO "totalPotStroops"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "totalPotStroops" TYPE bigint
      USING "totalPotStroops"::bigint * 10000000
    `);

    // ---- wagers: status gains the asynchronous settlement states ----
    // 'lost' is dropped: a pot has one row shared by both players, so the value
    // was never written by the old service. Any stray row is mapped to 'failed'
    // so that an operator sees it rather than it silently reading as settled.
    await queryRunner.query(`
      ALTER TYPE "public"."wager_status_enum" RENAME TO "wager_status_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."wager_status_enum" AS ENUM(
        'pending', 'awaiting_stakes', 'staked', 'settling', 'won', 'refunded', 'failed'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "status" TYPE "public"."wager_status_enum"
      USING (
        CASE "status"::text WHEN 'lost' THEN 'failed' ELSE "status"::text END
      )::"public"."wager_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" ALTER COLUMN "status" SET DEFAULT 'pending'
    `);
    await queryRunner.query(`DROP TYPE "public"."wager_status_enum_old"`);

    // ---- wagers: settlement bookkeeping ----
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ADD COLUMN "settlementMode" character varying(16) NOT NULL DEFAULT 'mock',
      ADD COLUMN "escrowTxHash" character varying(128),
      ADD COLUMN "playerAStakeTxHash" character varying(128),
      ADD COLUMN "playerBStakeTxHash" character varying(128),
      ADD COLUMN "settlementTxHash" character varying(128),
      ADD COLUMN "settlementLedger" bigint
    `);

    // One pot per session. The escrow contract enforces this on-chain by
    // rejecting a duplicate session; the database has to agree, otherwise a
    // retry writes a second row that can never be settled.
    await queryRunner.query(`DROP INDEX "public"."IDX_wagers_session_id"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wagers_session_id" ON "wagers" ("sessionId")
    `);

    // ---- game_sessions: wagerAmount (whole tokens) -> wagerStroops ----
    await queryRunner.query(`
      ALTER TABLE "game_sessions" RENAME COLUMN "wagerAmount" TO "wagerStroops"
    `);
    await queryRunner.query(`
      ALTER TABLE "game_sessions"
      ALTER COLUMN "wagerStroops" TYPE bigint
      USING "wagerStroops"::bigint * 10000000
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_sessions"
      ALTER COLUMN "wagerStroops" TYPE integer
      USING ("wagerStroops" / 10000000)::integer
    `);
    await queryRunner.query(`
      ALTER TABLE "game_sessions" RENAME COLUMN "wagerStroops" TO "wagerAmount"
    `);

    await queryRunner.query(`DROP INDEX "public"."UQ_wagers_session_id"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_wagers_session_id" ON "wagers" ("sessionId")
    `);

    await queryRunner.query(`
      ALTER TABLE "wagers"
      DROP COLUMN "settlementLedger",
      DROP COLUMN "settlementTxHash",
      DROP COLUMN "playerBStakeTxHash",
      DROP COLUMN "playerAStakeTxHash",
      DROP COLUMN "escrowTxHash",
      DROP COLUMN "settlementMode"
    `);

    // States with no pre-Stellar equivalent collapse onto the closest one the
    // old enum could express.
    await queryRunner.query(`
      ALTER TYPE "public"."wager_status_enum" RENAME TO "wager_status_enum_new"
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."wager_status_enum" AS ENUM(
        'pending', 'staked', 'won', 'lost', 'refunded'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "status" TYPE "public"."wager_status_enum"
      USING (
        CASE "status"::text
          WHEN 'awaiting_stakes' THEN 'pending'
          WHEN 'settling' THEN 'staked'
          WHEN 'failed' THEN 'pending'
          ELSE "status"::text
        END
      )::"public"."wager_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" ALTER COLUMN "status" SET DEFAULT 'pending'
    `);
    await queryRunner.query(`DROP TYPE "public"."wager_status_enum_new"`);

    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "totalPotStroops" TYPE integer
      USING ("totalPotStroops" / 10000000)::integer
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" RENAME COLUMN "totalPotStroops" TO "totalPot"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers"
      ALTER COLUMN "stakeStroops" TYPE integer
      USING ("stakeStroops" / 10000000)::integer
    `);
    await queryRunner.query(`
      ALTER TABLE "wagers" RENAME COLUMN "stakeStroops" TO "amount"
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "mockBalance" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "mockBalance" TYPE integer
      USING ("mockBalance" / 10000000)::integer
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "mockBalance" SET DEFAULT 100
    `);
    await queryRunner.query(`
      ALTER TABLE "users" RENAME COLUMN "mockBalance" TO "mockTokenBalance"
    `);

    await queryRunner.query(`DROP INDEX "public"."UQ_users_stellar_address"`);
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "stellarAddressVerifiedAt",
      DROP COLUMN "stellarAddress"
    `);
  }
}
