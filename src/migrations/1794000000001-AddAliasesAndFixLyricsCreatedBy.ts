import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings `lyrics` in line with the `Lyrics` entity:
 *
 * - adds `artistAliases` and `titleAliases` (a8252c9; issue R2-61), empty for
 *   existing lyrics;
 * - makes `createdById` nullable with ON DELETE SET NULL. On an empty database
 *   AddSetNullToLyricsCreatedBy runs before `lyrics` exists, so
 *   RepairSchemaToMatchEntities left the column NOT NULL with ON DELETE
 *   CASCADE. Databases where it did run have the hand-named
 *   `FK_lyrics_created_by`; both end with the name TypeORM derives;
 * - renames `CHK_lyrics_difficulty` to the name TypeORM derives for the
 *   entity's `@Check`, so `migration:check` stops reporting it.
 */
export class AddAliasesAndFixLyricsCreatedBy1794000000001
  implements MigrationInterface
{
  name = 'AddAliasesAndFixLyricsCreatedBy1794000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        ADD COLUMN IF NOT EXISTS "artistAliases" text array NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "titleAliases" text array NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT IF EXISTS "FK_lyrics_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT IF EXISTS "FK_11b6fbc73460d1fc82acf848400"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ALTER COLUMN "createdById" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ADD CONSTRAINT "FK_11b6fbc73460d1fc82acf848400" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT IF EXISTS "CHK_lyrics_difficulty"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT IF EXISTS "CHK_724269b17424f8da39f5be1fe4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ADD CONSTRAINT "CHK_724269b17424f8da39f5be1fe4" CHECK ("difficulty" BETWEEN 1 AND 5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT "CHK_724269b17424f8da39f5be1fe4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ADD CONSTRAINT "CHK_lyrics_difficulty" CHECK ("difficulty" BETWEEN 1 AND 5)`,
    );

    // The foreign key keeps ON DELETE SET NULL and the column stays nullable:
    // lyrics whose creator was deleted have no value to restore, and
    // AddSetNullToLyricsCreatedBy wants this shape anyway.

    await queryRunner.query(`
      ALTER TABLE "lyrics"
        DROP COLUMN "titleAliases",
        DROP COLUMN "artistAliases"
    `);
  }
}
