import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTournamentsAndSocialQueue1794300000005
  implements MigrationInterface
{
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE tournaments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL,
        format varchar(24) NOT NULL DEFAULT 'single_elimination',
        "maxPlayers" integer NOT NULL CHECK ("maxPlayers" BETWEEN 2 AND 64),
        "startsAt" timestamptz NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'registration',
        "winnerId" uuid
      );
      CREATE INDEX ON tournaments (status, "startsAt");
      CREATE TABLE tournament_entries (
        "tournamentId" uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seed integer NOT NULL,
        PRIMARY KEY ("tournamentId", "userId"),
        UNIQUE ("tournamentId", seed)
      );
      CREATE TABLE tournament_matches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        round integer NOT NULL,
        slot integer NOT NULL,
        "firstId" uuid,
        "secondId" uuid,
        "winnerId" uuid,
        "sessionId" uuid UNIQUE REFERENCES game_sessions(id) ON DELETE SET NULL,
        "lyricId" integer,
        "deadline" timestamptz,
        "firstPoints" integer,
        "secondPoints" integer,
        "firstAt" timestamptz,
        "secondAt" timestamptz,
        "finishedAt" timestamptz,
        UNIQUE ("tournamentId", round, slot)
      );
      CREATE TABLE friendships (
        "firstId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "secondId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "requesterId" uuid NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CHECK ("firstId" < "secondId"),
        PRIMARY KEY ("firstId", "secondId")
      );
      CREATE TABLE quick_match_queue (
        "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        "joinedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ON quick_match_queue ("joinedAt", "userId");
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TABLE quick_match_queue, friendships, tournament_matches,
        tournament_entries, tournaments
    `);
  }
}
