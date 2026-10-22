import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the room columns the `Room` entity gained without a migration: the
 * join code (ed28bb8, #92; issue R2-70) and the host, player limit and
 * lifecycle fields (issue R2-73).
 *
 * Existing rooms get a unique code from the alphabet `RoomsService` uses, so
 * the column can be NOT NULL, and rooms already closed are marked finished.
 * Every step is guarded, so a database that already has some of these
 * columns (for example one built with `synchronize`) is brought in line too.
 */
export class AddRoomCodeHostAndLifecycle1794000000000
  implements MigrationInterface
{
  name = 'AddRoomCodeHostAndLifecycle1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = 'rooms_status_enum'
        ) THEN
          CREATE TYPE "public"."rooms_status_enum" AS ENUM('lobby', 'in_progress', 'finished');
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "rooms"
        ADD COLUMN IF NOT EXISTS "code" character varying(6),
        ADD COLUMN IF NOT EXISTS "hostId" character varying,
        ADD COLUMN IF NOT EXISTS "maxPlayers" integer NOT NULL DEFAULT '8',
        ADD COLUMN IF NOT EXISTS "status" "public"."rooms_status_enum" NOT NULL DEFAULT 'lobby',
        ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "roundCount" integer NOT NULL DEFAULT '0'
    `);

    // Same alphabet and length as RoomsService.generateRoomCode (no 0/O, 1/I).
    await queryRunner.query(`
      DO $$
      DECLARE
        room RECORD;
        alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        candidate text;
      BEGIN
        FOR room IN SELECT "id" FROM "rooms" WHERE "code" IS NULL LOOP
          LOOP
            candidate := '';
            FOR i IN 1..6 LOOP
              candidate := candidate
                || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
            END LOOP;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "rooms" WHERE "code" = candidate);
          END LOOP;
          UPDATE "rooms" SET "code" = candidate WHERE "id" = room."id";
        END LOOP;
      END $$
    `);

    await queryRunner.query(
      `UPDATE "rooms" SET "status" = 'finished' WHERE "isClosed" = true AND "status" = 'lobby'`,
    );

    await queryRunner.query(
      `ALTER TABLE "rooms" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "UQ_368d83b661b9670e7be1bbb9cdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD CONSTRAINT "UQ_368d83b661b9670e7be1bbb9cdd" UNIQUE ("code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_368d83b661b9670e7be1bbb9cd" ON "rooms" ("code") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_368d83b661b9670e7be1bbb9cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "UQ_368d83b661b9670e7be1bbb9cdd"`,
    );
    await queryRunner.query(`
      ALTER TABLE "rooms"
        DROP COLUMN IF EXISTS "roundCount",
        DROP COLUMN IF EXISTS "startedAt",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "maxPlayers",
        DROP COLUMN IF EXISTS "hostId",
        DROP COLUMN IF EXISTS "code"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."rooms_status_enum"`);
  }
}
