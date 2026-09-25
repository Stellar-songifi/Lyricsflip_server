import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the top level title 'Gossip God' to 'Gossip Guru', the value that
 * `UserLevel.GOSSIP_GURU` saves.
 *
 * 'Gossip God' only exists in databases built from the stray root-level
 * CreateGameHistoryTable migration. Anywhere else the enum type is missing or
 * already correct, and this does nothing.
 */
export class RenameGossipGodToGossipGuru1790363500000
  implements MigrationInterface
{
  name = 'RenameGossipGodToGossipGuru1790363500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typname = 'users_leveltitle_enum'
            AND e.enumlabel = 'Gossip God'
        ) THEN
          ALTER TYPE "public"."users_leveltitle_enum"
          RENAME VALUE 'Gossip God' TO 'Gossip Guru';
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // Not reverted: 'Gossip God' was never a value the application could save,
    // and databases that never had it would be broken by renaming it back.
  }
}
