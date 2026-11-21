import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { GuessType } from '../game/dto/guess.dto';

describe('ChallengesService', () => {
  const day = '2026-09-26';
  const lyricIds = [4, 8, 15];
  const userId = 'user-1';

  // Simulate the rounds table: keyed by round id.
  let rounds: Map<string, any>;
  let roundCounter: number;
  let attempts: any[];
  let stored: any;
  let activeLyricIds: number[];

  /**
   * Builds a fake round id for a (userId, lyricId, dailyDate) tuple.
   * Deterministic so we can predict the id in test assertions.
   */
  const roundIdFor = (lyricId: number) => `round-${lyricId}`;

  const challengeRepo = {
    findOne: jest.fn(async () => stored),
    findOneOrFail: jest.fn(async () => stored),
    createQueryBuilder: jest.fn(() => ({
      insert: () => ({
        values: (row: any) => ({
          orIgnore: () => ({
            execute: async () => {
              stored ??= row;
            },
          }),
        }),
      }),
    })),
  };

  const attemptRepo = {
    find: jest.fn(async () => attempts),
    insert: jest.fn(async (row: any) => {
      if (attempts.some((a) => a.lyricId === row.lyricId)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      attempts.push(row);
    }),
  };

  const lyricsRepo = {
    find: jest.fn(async () =>
      activeLyricIds.map((id) => ({ id, lyricSnippet: `snippet-${id}` })),
    ),
  };

  const roundRepo = {
    find: jest.fn(async ({ where }: { where: any }) => {
      // Return existing rounds for this user/day.
      return [...rounds.values()].filter(
        (r) => r.userId === where.userId && r.dailyDate === where.dailyDate,
      );
    }),
    findOne: jest.fn(async ({ where }: { where: any }) => {
      // Look up by roundId + userId + dailyDate.
      const r = rounds.get(where.id);
      if (!r) return null;
      if (r.userId !== where.userId) return null;
      if (where.dailyDate !== undefined && r.dailyDate !== where.dailyDate) return null;
      return r;
    }),
  };

  const game = {
    issueRound: jest.fn(async (uid: string, lyricId: number, _session: any, dailyDate: string) => {
      const id = roundIdFor(lyricId);
      const round = { id, userId: uid, lyricId, dailyDate, closedAt: null };
      rounds.set(id, round);
      return round;
    }),
    guessRound: jest.fn(async (uid: string, dto: any) => {
      const r = rounds.get(dto.roundId);
      if (!r || r.userId !== uid) throw new NotFoundException('Round not found');
      if (r.closedAt) throw new ConflictException('Already guessed');
      r.closedAt = new Date();
      return {
        isCorrect: true,
        correctAnswer: 'Artist',
        explanation: 'Correct!',
        points: 100,
        timedOut: false,
      };
    }),
  };

  const xp = { handleCorrectGuess: jest.fn() };
  const events = { emit: jest.fn() };
  const config = { get: jest.fn((key: string) => {
    if (key === 'DAILY_CHALLENGE_SALT') return 'test-salt';
    if (key === 'NODE_ENV') return 'test';
    return undefined;
  })};

  const service = () =>
    new ChallengesService(
      challengeRepo as any,
      attemptRepo as any,
      lyricsRepo as any,
      roundRepo as any,
      game as any,
      xp as any,
      events as any,
      config as any,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(`${day}T10:00:00.000Z`) });
    jest.clearAllMocks();
    attempts = [];
    stored = undefined;
    activeLyricIds = [1, 2, 3, 4, 8, 15];
    rounds = new Map();
    roundCounter = 0;
  });

  afterEach(() => jest.useRealTimers());

  it('gives every caller the same set on the same UTC day', async () => {
    const first = await service().getDailyLyricIds(day);
    const second = await service().getDailyLyricIds(day);

    expect(first).toEqual(second);
    expect(stored.date).toBe(day);
  });

  it('issues a round for each lyric and returns roundIds in getDaily', async () => {
    stored = { date: day, lyricIds };
    const view = await service().getDaily(userId);

    expect(view.lyrics).toHaveLength(lyricIds.length);
    for (const lyric of view.lyrics) {
      expect(lyric.roundId).toBeDefined();
    }
    expect(game.issueRound).toHaveBeenCalledTimes(lyricIds.length);
  });

  it('allows one attempt per lyric, awards XP for correct in-window guess', async () => {
    stored = { date: day, lyricIds };
    // Pre-issue rounds.
    for (const id of lyricIds) {
      rounds.set(roundIdFor(id), { id: roundIdFor(id), userId, lyricId: id, dailyDate: day, closedAt: null });
    }

    const dto = { roundId: roundIdFor(4), guessType: GuessType.ARTIST, guessValue: 'Artist' };

    const first = await service().guess(userId, dto);
    expect(first).toMatchObject({ isCorrect: true, points: 100, completed: false });
    expect(xp.handleCorrectGuess).toHaveBeenCalledWith(userId);

    // Attempting the same round again: guessRound throws ConflictException (round already closed).
    await expect(service().guess(userId, dto)).rejects.toThrow(ConflictException);
    expect(xp.handleCorrectGuess).toHaveBeenCalledTimes(1);
  });

  it("rejects a round that is not in today's challenge", async () => {
    stored = { date: day, lyricIds };
    // A round for lyric 99, which is not in today's set.
    rounds.set('round-99', { id: 'round-99', userId, lyricId: 99, dailyDate: day, closedAt: null });

    await expect(
      service().guess(userId, {
        roundId: 'round-99',
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a round for the wrong user', async () => {
    stored = { date: day, lyricIds };
    rounds.set(roundIdFor(4), { id: roundIdFor(4), userId: 'other-user', lyricId: 4, dailyDate: day, closedAt: null });

    await expect(
      service().guess(userId, {
        roundId: roundIdFor(4),
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('scores 0 when guessRound signals a timeout', async () => {
    stored = { date: day, lyricIds };
    rounds.set(roundIdFor(4), { id: roundIdFor(4), userId, lyricId: 4, dailyDate: day, closedAt: null });

    // Override guessRound to simulate a timed-out response.
    game.guessRound.mockResolvedValueOnce({
      isCorrect: false,
      correctAnswer: 'Artist',
      explanation: 'Too late',
      points: 0,
      timedOut: true,
    });

    const result = await service().guess(userId, {
      roundId: roundIdFor(4),
      guessType: GuessType.ARTIST,
      guessValue: 'Artist',
    });

    expect(result.points).toBe(0);
    expect(xp.handleCorrectGuess).not.toHaveBeenCalled();
  });

  it('scores 0 when guessRound throws GoneException (round expired)', async () => {
    stored = { date: day, lyricIds };
    rounds.set(roundIdFor(4), { id: roundIdFor(4), userId, lyricId: 4, dailyDate: day, closedAt: null });

    game.guessRound.mockRejectedValueOnce(new GoneException('This round has expired'));

    await expect(
      service().guess(userId, {
        roundId: roundIdFor(4),
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      }),
    ).rejects.toThrow(GoneException);
  });

  it('emits user.completed_challenge once the whole set is attempted', async () => {
    stored = { date: day, lyricIds };
    for (const id of lyricIds) {
      rounds.set(roundIdFor(id), { id: roundIdFor(id), userId, lyricId: id, dailyDate: day, closedAt: null });
    }
    const svc = service();

    for (const lyricId of lyricIds) {
      await svc.guess(userId, {
        roundId: roundIdFor(lyricId),
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      });
    }

    expect(events.emit).toHaveBeenCalledWith(
      'user.completed_challenge',
      expect.objectContaining({ userId }),
    );
  });

  it('still completes the challenge when a lyric is deactivated mid-day', async () => {
    stored = { date: day, lyricIds };
    // Lyric 8 is deactivated after the day's set was drawn.
    activeLyricIds = [1, 2, 3, 4, 15];
    for (const id of [4, 15]) {
      rounds.set(roundIdFor(id), { id: roundIdFor(id), userId, lyricId: id, dailyDate: day, closedAt: null });
    }
    const svc = service();

    for (const lyricId of [4, 15]) {
      await svc.guess(userId, {
        roundId: roundIdFor(lyricId),
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      });
    }

    expect(events.emit).toHaveBeenCalledWith(
      'user.completed_challenge',
      expect.objectContaining({ userId }),
    );
  });
});
