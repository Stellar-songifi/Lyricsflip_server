import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { GuessType } from '../game/dto/guess.dto';

describe('ChallengesService', () => {
  const day = '2026-09-26';
  const lyricIds = [4, 8, 15];
  const userId = 'user-1';

  let attempts: any[];
  let stored: any;
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
    find: jest.fn(async () => [1, 2, 3, 4, 8, 15].map((id) => ({ id }))),
  };
  const game = {
    validateGuess: jest.fn(() => ({ isValid: true })),
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
      attemptRepo as any,
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
});
