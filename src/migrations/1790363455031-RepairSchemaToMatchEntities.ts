import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings a database built by the earlier migrations in line with the entities.
 *
 * Generated with `migration:generate` after running the rest of the chain on an
 * empty database. It creates `lyrics` and `game_history`, adds the `users`
 * columns the entities expect, changes `room_users.userId` to the uuid type of
 * `users.id`, adds the foreign keys to `lyrics` and `users` that
 * CreateRoomsAndRoomUsers could not create, and swaps hand-named constraints and
 * indexes for the names TypeORM derives, so that later generated migrations
 * contain only real changes. See docs/MIGRATIONS.md.
 */
export class RepairSchemaToMatchEntities1790363455031
  implements MigrationInterface
{
  name = 'RepairSchemaToMatchEntities1790363455031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_player_game_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_game_sessions_player_two"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_game_sessions_winner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_wagers_player_a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_wagers_player_b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_wagers_winner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" DROP CONSTRAINT "FK_07600e6f053913a639e4478f2e5"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_users_stellar_address"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_wagers_session_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_game_rounds_user_id"`);
    await queryRunner.query(
      `CREATE TYPE "public"."lyrics_genre_enum" AS ENUM('Afrobeats', 'Hip-Hop', 'Pop', 'Other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "lyrics" ("id" SERIAL NOT NULL, "content" text NOT NULL, "artist" character varying NOT NULL, "lyricSnippet" text NOT NULL, "songTitle" character varying(200) NOT NULL, "category" character varying(50), "genre" "public"."lyrics_genre_enum" NOT NULL DEFAULT 'Other', "decade" character varying(10) NOT NULL, "difficulty" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "timesUsed" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "createdById" uuid NOT NULL, CONSTRAINT "UQ_4f0ed33e3fa900864b7523c5563" UNIQUE ("artist", "songTitle"), CONSTRAINT "PK_f7c5de22ef94f309591c5554f0f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d14fb81820a5ebfc89df735201" ON "lyrics" ("category") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2d5f0b6948cd8f9c8b288e483" ON "lyrics" ("genre") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_acaad25bc17807f76cea53b163" ON "lyrics" ("decade") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_history_guesstype_enum" AS ENUM('artist', 'songTitle')`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "playerId" uuid NOT NULL, "lyricId" integer NOT NULL, "gameSessionId" uuid, "guessType" "public"."game_history_guesstype_enum" NOT NULL, "guessValue" character varying(200) NOT NULL, "isCorrect" boolean NOT NULL, "pointsAwarded" integer NOT NULL DEFAULT '0', "xpChange" integer NOT NULL DEFAULT '0', "wagerAmount" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0e74b90c56b815ed54e90a29f1a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_54d592c33eee3f06a10aee8634" ON "game_history" ("playerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed6f230775ab9828edf585b6fe" ON "game_history" ("lyricId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f9154e4f1451ad1bf37732d23" ON "game_history" ("gameSessionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d37db6e0872941f431472c64d1" ON "game_history" ("isCorrect") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b2126d153baaa3f5c73f0c0ca" ON "game_history" ("createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "username" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "xp" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "level" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_leveltitle_enum" AS ENUM('Gossip Rookie', 'Word Whisperer', 'Lyric Sniper', 'Bar Genius', 'Gossip Guru')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "levelTitle" "public"."users_leveltitle_enum" NOT NULL DEFAULT 'Gossip Rookie'`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "lastLoginAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" character varying(20) NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "isActive" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_6ca644d6db1d091834d0d181c2f" UNIQUE ("stellarAddress")`,
    );
    await queryRunner.query(`ALTER TABLE "room_users" DROP COLUMN "userId"`);
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD "userId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ALTER COLUMN "joinedAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ALTER COLUMN "createdAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ca644d6db1d091834d0d181c2" ON "users" ("stellarAddress") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ae4afddd5a9aed864218840a89" ON "wagers" ("sessionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6333fb3ac6455083f5d63bea1" ON "game_rounds" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD CONSTRAINT "UQ_13fbb37ae42be6ad72b4724ec52" UNIQUE ("userId", "roomId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_15cde5fb27498c38d3e6be4192b" FOREIGN KEY ("playerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_dc0de8724b56bcde2bed53228cf" FOREIGN KEY ("playerTwoId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_05fc1fa1e3c6d734c07ea753aa6" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_23053e7556c275c08c36cc6e7ab" FOREIGN KEY ("playerAId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_9a822637150835af40ce9ea7a56" FOREIGN KEY ("playerBId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_eea91b8d8ca8f757286d9b6e031" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ADD CONSTRAINT "FK_11b6fbc73460d1fc82acf848400" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD CONSTRAINT "FK_9afe64dc52abd16b1830c8767b0" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD CONSTRAINT "FK_07600e6f053913a639e4478f2e5" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD CONSTRAINT "FK_9458c1f50798bb0aca55b2e8b9e" FOREIGN KEY ("lyricId") REFERENCES "lyrics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_history" ADD CONSTRAINT "FK_54d592c33eee3f06a10aee86348" FOREIGN KEY ("playerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_history" ADD CONSTRAINT "FK_ed6f230775ab9828edf585b6fee" FOREIGN KEY ("lyricId") REFERENCES "lyrics"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_history" ADD CONSTRAINT "FK_8f9154e4f1451ad1bf37732d230" FOREIGN KEY ("gameSessionId") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_history" DROP CONSTRAINT "FK_8f9154e4f1451ad1bf37732d230"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_history" DROP CONSTRAINT "FK_ed6f230775ab9828edf585b6fee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_history" DROP CONSTRAINT "FK_54d592c33eee3f06a10aee86348"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP CONSTRAINT "FK_9458c1f50798bb0aca55b2e8b9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" DROP CONSTRAINT "FK_07600e6f053913a639e4478f2e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" DROP CONSTRAINT "FK_9afe64dc52abd16b1830c8767b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT "FK_11b6fbc73460d1fc82acf848400"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_eea91b8d8ca8f757286d9b6e031"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_9a822637150835af40ce9ea7a56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" DROP CONSTRAINT "FK_23053e7556c275c08c36cc6e7ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_05fc1fa1e3c6d734c07ea753aa6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_dc0de8724b56bcde2bed53228cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_15cde5fb27498c38d3e6be4192b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" DROP CONSTRAINT "UQ_13fbb37ae42be6ad72b4724ec52"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6333fb3ac6455083f5d63bea1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae4afddd5a9aed864218840a89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ca644d6db1d091834d0d181c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ALTER COLUMN "joinedAt" SET DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "room_users" DROP COLUMN "userId"`);
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD "userId" integer NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_6ca644d6db1d091834d0d181c2f"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isActive"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastLoginAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "levelTitle"`);
    await queryRunner.query(`DROP TYPE "public"."users_leveltitle_enum"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "level"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "xp"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2b2126d153baaa3f5c73f0c0ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d37db6e0872941f431472c64d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f9154e4f1451ad1bf37732d23"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed6f230775ab9828edf585b6fe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_54d592c33eee3f06a10aee8634"`,
    );
    await queryRunner.query(`DROP TABLE "game_history"`);
    await queryRunner.query(`DROP TYPE "public"."game_history_guesstype_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_acaad25bc17807f76cea53b163"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2d5f0b6948cd8f9c8b288e483"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d14fb81820a5ebfc89df735201"`,
    );
    await queryRunner.query(`DROP TABLE "lyrics"`);
    await queryRunner.query(`DROP TYPE "public"."lyrics_genre_enum"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_rounds_user_id" ON "game_rounds" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_wagers_session_id" ON "wagers" ("sessionId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_stellar_address" ON "users" ("stellarAddress") `,
    );
    await queryRunner.query(
      `ALTER TABLE "room_users" ADD CONSTRAINT "FK_07600e6f053913a639e4478f2e5" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_wagers_winner" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_wagers_player_b" FOREIGN KEY ("playerBId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wagers" ADD CONSTRAINT "FK_wagers_player_a" FOREIGN KEY ("playerAId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_game_sessions_winner" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_game_sessions_player_two" FOREIGN KEY ("playerTwoId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_player_game_session" FOREIGN KEY ("playerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
