import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { GuessType } from '../game/dto/guess.dto';

// The daily challenge uses the mock game scorer below.
jest.mock('../game/game.service', () => ({ GameLogicService: class {} }));
jest.mock('../xp-level/xp-level.service', () => ({ XpLevelService: class {} }));

describe('ChallengesService', () => {
  const day = '2026-09-26';
  const lyricIds = [4, 8, 15];
  const userId = 'user-1';

  let attempts: any[];
  let stored: any;
  let activeLyricIds: number[];
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
  const updatePlayer = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => ({ raw: [] })),
  };
  const transactionalAttempts = {
    ...attemptRepo,
    manager: {
      transaction: async (run: (manager: unknown) => Promise<unknown>) =>
        run({
          createQueryBuilder: () => updatePlayer,
          insert: (_entity: unknown, row: unknown) => attemptRepo.insert(row),
        }),
    },
  };
  const lyricsRepo = {
    find: jest.fn(async () => activeLyricIds.map((id) => ({ id }))),
  };
  const game = {
    checkGuess: jest.fn(async () => ({
      isCorrect: true,
      correctAnswer: 'Artist',
      explanation: 'Correct!',
      points: 100,
    })),
  };
  const xp = { handleCorrectGuess: jest.fn() };
  const events = { emit: jest.fn() };

  const service = () =>
    new ChallengesService(
      challengeRepo as any,
      transactionalAttempts as any,
      lyricsRepo as any,
      game as any,
      xp as any,
      events as any,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(`${day}T10:00:00.000Z`) });
    jest.clearAllMocks();
    attempts = [];
    stored = undefined;
    activeLyricIds = [1, 2, 3, 4, 8, 15];
  });

  afterEach(() => jest.useRealTimers());

  it('gives every caller the same set on the same UTC day', async () => {
    const first = await service().getDailyLyricIds(day);
    const second = await service().getDailyLyricIds(day);

    expect(first).toEqual(second);
    expect(stored.date).toBe(day);
  });

  it('allows one attempt per lyric, and awards XP for a correct one', async () => {
    stored = { date: day, lyricIds };
    const dto = {
      lyricId: 4,
      guessType: GuessType.ARTIST,
      guessValue: 'Artist',
    };

    const first = await service().guess(userId, dto);
    expect(first).toMatchObject({
      isCorrect: true,
      points: 100,
      completed: false,
    });
    expect(xp.handleCorrectGuess).toHaveBeenCalledWith(userId);

    await expect(service().guess(userId, dto)).rejects.toThrow(
      ConflictException,
    );
    expect(xp.handleCorrectGuess).toHaveBeenCalledTimes(1);
  });

  it('shares only the day number, score and outcome squares in lyric order', async () => {
    stored = { date: '2026-09-24', lyricIds };
    attempts = [
      { lyricId: 15, isCorrect: false, points: 0, guessValue: 'Wrong artist' },
      { lyricId: 4, isCorrect: true, points: 100, correctAnswer: 'Artist' },
    ];
    await expect(service().getShare(userId)).resolves.toBe(
      'Lyricsflip Daily #3 · 100 pts\n🟩⬜🟥',
    );
  });

  it("rejects a lyric that is not in today's set", async () => {
    stored = { date: day, lyricIds };

    await expect(
      service().guess(userId, {
        lyricId: 99,
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('emits user.completed_challenge once the whole set is attempted', async () => {
    stored = { date: day, lyricIds };
    const svc = service();

    for (const lyricId of lyricIds) {
      await svc.guess(userId, {
        lyricId,
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      });
    }

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'user.completed_challenge',
      expect.objectContaining({ userId, streakCount: 3 }),
    );
  });

  it('still completes the challenge when a lyric is deactivated mid-day', async () => {
    stored = { date: day, lyricIds };
    // Lyric 8 is deactivated after the day's set was drawn.
    activeLyricIds = [1, 2, 3, 4, 15];
    const svc = service();

    for (const lyricId of [4, 15]) {
      await svc.guess(userId, {
        lyricId,
        guessType: GuessType.ARTIST,
        guessValue: 'Artist',
      });
    }

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'user.completed_challenge',
      expect.objectContaining({ userId, streakCount: 2 }),
    );
  });
});
