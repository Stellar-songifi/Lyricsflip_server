import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlayerReports1794300000004 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE player_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reporterId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "playerId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason varchar(40) NOT NULL,
        note varchar(500),
        status varchar(16) NOT NULL DEFAULT 'open',
        "resolvedBy" uuid REFERENCES users(id) ON DELETE SET NULL,
        resolution varchar(500),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "resolvedAt" timestamptz
      );
      CREATE UNIQUE INDEX "UQ_open_player_report"
        ON player_reports ("reporterId", "playerId") WHERE status = 'open';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE player_reports');
  }
}
