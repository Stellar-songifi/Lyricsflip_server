import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserBlocks1794300000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_blocks" (
        "blockerId" uuid NOT NULL,
        "blockedId" uuid NOT NULL,
        CONSTRAINT "PK_user_blocks" PRIMARY KEY ("blockerId", "blockedId"),
        CONSTRAINT "FK_user_blocks_blocker" FOREIGN KEY ("blockerId")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_blocks_blocked" FOREIGN KEY ("blockedId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "user_blocks"');
  }
}
