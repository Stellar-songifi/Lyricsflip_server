import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `lyrics.createdBy` was a required column with an ON DELETE CASCADE foreign
 * key: hard-deleting the admin who seeded the catalogue deleted every lyric
 * they created (and cascaded further into game_history/rooms). This makes
 * the column nullable and replaces the constraint with ON DELETE SET NULL.
 *
 * The existing FK constraint name is looked up dynamically because the
 * lyrics table's foreign keys were created by TypeORM synchronize rather
 * than a tracked migration, so no fixed constraint name can be relied on.
 */
export class AddSetNullToLyricsCreatedBy1758900000000
  implements MigrationInterface
{
  name = 'AddSetNullToLyricsCreatedBy1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [constraint] = await queryRunner.query(`
      SELECT tc.constraint_name AS name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'lyrics'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'createdById'
    `);

    if (constraint?.name) {
      await queryRunner.query(
        `ALTER TABLE "lyrics" DROP CONSTRAINT "${constraint.name}"`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "lyrics" ALTER COLUMN "createdById" DROP NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "lyrics"
      ADD CONSTRAINT "FK_lyrics_created_by"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lyrics" DROP CONSTRAINT "FK_lyrics_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lyrics" ALTER COLUMN "createdById" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "lyrics"
      ADD CONSTRAINT "FK_lyrics_created_by"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }
}
