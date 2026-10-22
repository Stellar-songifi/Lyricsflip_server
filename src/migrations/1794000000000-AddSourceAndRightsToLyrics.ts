import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records where each lyric came from and under what rights (issue R2-89).
 *
 *   1. Adds source, sourceUrl, licence and addedBy. Existing rows get
 *      source = 'unknown' so the column can be NOT NULL; an admin can then
 *      filter on 'unknown' to find rows that still need a source recorded.
 *      addedBy is backfilled from createdById where there is one.
 *   2. Stops storing full lyric text. The game only serves lyricSnippet, so
 *      `content` becomes nullable and existing full text is cleared. Every
 *      row already has a non-empty lyricSnippet (NOT NULL), so nothing the
 *      game uses is lost.
 *
 * down() restores the columns' shape but cannot bring back the cleared
 * content: it fills `content` from lyricSnippet so the NOT NULL constraint
 * can be reinstated.
 */
export class AddSourceAndRightsToLyrics1794000000000
  implements MigrationInterface
{
  name = 'AddSourceAndRightsToLyrics1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        ADD COLUMN "source" character varying(100) NOT NULL DEFAULT 'unknown',
        ADD COLUMN "sourceUrl" character varying(500),
        ADD COLUMN "licence" character varying(100),
        ADD COLUMN "addedBy" character varying(100)
    `);
    // The default only exists to backfill; new rows must name their source.
    await queryRunner.query(`
      ALTER TABLE "lyrics" ALTER COLUMN "source" DROP DEFAULT
    `);
    await queryRunner.query(`
      UPDATE "lyrics" SET "addedBy" = "createdById"::text
      WHERE "createdById" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lyrics_source" ON "lyrics" ("source")
    `);

    await queryRunner.query(`
      ALTER TABLE "lyrics" ALTER COLUMN "content" DROP NOT NULL
    `);
    await queryRunner.query(`UPDATE "lyrics" SET "content" = NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "lyrics" SET "content" = "lyricSnippet" WHERE "content" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lyrics" ALTER COLUMN "content" SET NOT NULL
    `);

    await queryRunner.query(`DROP INDEX "IDX_lyrics_source"`);
    await queryRunner.query(`
      ALTER TABLE "lyrics"
        DROP COLUMN "addedBy",
        DROP COLUMN "licence",
        DROP COLUMN "sourceUrl",
        DROP COLUMN "source"
    `);
  }
}
