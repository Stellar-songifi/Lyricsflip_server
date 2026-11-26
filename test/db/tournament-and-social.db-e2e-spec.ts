import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, QueryRunner } from 'typeorm';
import {
  GameSession,
  GameSessionStatus,
} from '../../src/game-sessions/entities/game-session.entity';
import { Lyrics } from '../../src/lyrics/entities/lyrics.entity';
import { CreateTournamentsAndSocialQueue1794300000005 } from '../../src/migrations/1794300000005-CreateTournamentsAndSocialQueue';
import { UserBlock } from '../../src/moderation/user-block.entity';
import { RealtimeEvent } from '../../src/realtime/realtime.events';
import { SocialService } from '../../src/social/social.service';
import { TournamentsService } from '../../src/tournaments/tournaments.service';
import { User } from '../../src/users/entities/user.entity';

describe('Tournament and social flows', () => {
  const schema = `social_test_${randomUUID().replaceAll('-', '')}`;
  let db: DataSource;
  let runner: QueryRunner;
  let events: EventEmitter2;
  let tournaments: TournamentsService;
  let social: SocialService;
  let players: string[];

  beforeAll(async () => {
    db = await new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/test',
      schema,
      extra: { options: `-c search_path=${schema},public` },
      entities: [User, GameSession, Lyrics, UserBlock],
    }).initialize();
    runner = db.createQueryRunner();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`
      CREATE FUNCTION generate_referral_code() RETURNS varchar(16)
      LANGUAGE sql VOLATILE AS $$ SELECT substr(md5(gen_random_uuid()::text), 1, 16)::varchar(16) $$
    `);
    await db.synchronize();
    await new CreateTournamentsAndSocialQueue1794300000005().up(runner);
    events = new EventEmitter2();
    tournaments = new TournamentsService(db, events);
    social = new SocialService(db, events);

    const users = db.getRepository(User);
    players = [];
    for (let i = 0; i < 8; i++) {
      const user = await users.save(
        users.create({
          username: `player${i}`,
          email: `player${i}@example.test`,
          passwordHash: 'test-hash',
          referralCode: `player-${i}`,
        }),
      );
      players.push(user.id);
    }
    const lyrics = db.getRepository(Lyrics);
    await lyrics.save(
      lyrics.create({
        artist: 'Test Artist',
        songTitle: 'Sample Song',
        lyricSnippet: 'A shared lyric',
        decade: '2000s',
        source: 'test',
      }),
    );
  });

  afterAll(async () => {
    if (!runner) return;
    await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await runner.release();
    await db.destroy();
  });

  async function start(count: number) {
    const tournament = await tournaments.create(
      'Weekend bracket',
      8,
      new Date(Date.now() + 60_000),
    );
    for (const userId of players.slice(0, count)) {
      await tournaments.register(tournament.id, userId);
    }
    await runner.query(
      'UPDATE tournaments SET "startsAt" = now() WHERE id = $1',
      [tournament.id],
    );
    await tournaments.processDue();
    return tournament.id;
  }

  it('advances eight players automatically and exposes all seven results', async () => {
    const changes = jest.fn();
    events.on(RealtimeEvent.TOURNAMENT_BRACKET_UPDATED, changes);
    const id = await start(8);
    await expect(tournaments.register(id, players[0])).rejects.toMatchObject({
      status: 409,
    });

    for (let round = 1; round <= 3; round++) {
      const bracket = await tournaments.bracket(id);
      const active = bracket.matches.filter((match) => match.round === round);
      expect(active).toHaveLength(2 ** (3 - round));
      for (const match of active) {
        expect(match.sessionId).toBeTruthy();
        expect(match).not.toHaveProperty('firstPoints');
        const [first, second] = await Promise.all([
          tournaments.question(id, match.id, match.firstId!),
          tournaments.question(id, match.id, match.secondId!),
        ]);
        expect(first).toEqual(second);
        expect(first).not.toHaveProperty('songTitle');
        await Promise.all([
          tournaments.guess(id, match.id, match.firstId!, 'Sample Song'),
          tournaments.guess(id, match.id, match.secondId!, 'Wrong'),
        ]);
      }
    }
    const bracket = await tournaments.bracket(id);
    expect(bracket).toMatchObject({
      status: 'completed',
      winnerId: players[0],
    });
    expect(bracket.matches).toHaveLength(7);
    for (const match of bracket.matches) {
      expect(match.winnerId).toBe(match.firstId);
      expect(match.firstPoints).toBeGreaterThan(0);
      expect(match.secondPoints).toBe(0);
      const session = await db
        .getRepository(GameSession)
        .findOneByOrFail({ id: match.sessionId! });
      expect(session).toMatchObject({
        status: GameSessionStatus.COMPLETED,
        winnerId: match.winnerId,
      });
    }
    expect(changes).toHaveBeenCalledWith({ tournamentId: id, players });
    events.off(RealtimeEvent.TOURNAMENT_BRACKET_UPDATED, changes);
  });

  it('assigns a bye without creating a session', async () => {
    const id = await start(3);
    const bracket = await tournaments.bracket(id);
    expect(
      bracket.matches.find((match) => match.round === 1 && !match.secondId),
    ).toMatchObject({ winnerId: players[0], sessionId: null });
  });

  it('closes an expired match and advances a player who answered in time', async () => {
    const id = await start(2);
    const [match] = (await tournaments.bracket(id)).matches;
    await tournaments.guess(id, match.id, match.secondId!, 'Sample Song');
    await runner.query(
      'UPDATE tournament_matches SET "deadline" = now() WHERE id = $1',
      [match.id],
    );
    await expect(
      tournaments.guess(id, match.id, match.firstId!, 'Sample Song'),
    ).rejects.toMatchObject({ status: 409 });
    await tournaments.processDue();
    await expect(tournaments.bracket(id)).resolves.toMatchObject({
      status: 'completed',
      winnerId: match.secondId,
    });
  });

  it('rejects friendship requests and excludes blocked players from actual matchmaking', async () => {
    const [first, second, third] = players;
    await social.requestFriend(first, second);
    await db.manager.insert(UserBlock, { blockerId: second, blockedId: first });
    const neutral = { status: 403, message: 'This interaction is unavailable' };
    await expect(social.requestFriend(first, second)).rejects.toMatchObject(
      neutral,
    );
    await expect(social.requestFriend(second, first)).rejects.toMatchObject(
      neutral,
    );
    await expect(social.acceptFriend(second, first)).rejects.toMatchObject(
      neutral,
    );
    await expect(social.enqueue(first)).resolves.toEqual({ sessionId: null });
    await expect(social.enqueue(second)).resolves.toEqual({ sessionId: null });
    const { sessionId } = await social.enqueue(third);
    expect(sessionId).toBeTruthy();
    const match = await db.getRepository(GameSession).findOneOrFail({
      where: { id: sessionId! },
      relations: { player: true },
    });
    expect(match.player.id).toBe(first);
    expect(match.playerTwoId).toBe(third);
    await expect(social.enqueue(second)).resolves.toEqual({ sessionId: null });
  });
});
