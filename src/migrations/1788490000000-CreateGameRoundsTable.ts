import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGameRoundsTable1788490000000 implements MigrationInterface {
  name = 'CreateGameRoundsTable1788490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_rounds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "lyricId" integer NOT NULL,
        "issuedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP NOT NULL,
        "closedAt" TIMESTAMP,
        CONSTRAINT "PK_game_rounds" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_game_rounds_user_id" ON "game_rounds" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_game_rounds_user_id"`);
    await queryRunner.query(`DROP TABLE "game_rounds"`);
  }
}
