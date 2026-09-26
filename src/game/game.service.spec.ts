import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GameSession } from 'src/game-sessions/entities/game-session.entity';
import { Genre, Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameLogicService, GuessDto } from './game.service';
import { GuessType } from './dto/guess.dto';
import { GameRound } from './entities/game-round.entity';
import { User } from 'src/users/entities/user.entity';

describe('GameLogicService', () => {
  let service: GameLogicService;
  let repository: jest.Mocked<Repository<Lyrics>>;
  let roundRepository: jest.Mocked<Repository<GameRound>>;
  let sessionRepository: jest.Mocked<Repository<GameSession>>;
  let events: { emit: jest.Mock };
  let queryBuilder: jest.Mocked<SelectQueryBuilder<Lyrics>>;

  const mockLyric: Lyrics = {
    id: 1,
    lyricSnippet: 'Test lyric snippet for testing',
    songTitle: 'Test Song',
    artist: 'Test Artist',
    artistAliases: [],
    titleAliases: [],
    category: 'Pop',
    decade: '2020s',
    genre: Genre.Pop,
    difficulty: 3,
    isActive: true,
    timesUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    content: 'Full lyric content for testing',
    createdBy: {
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
    } as unknown as User, // 👈 cast so we don't need to mock every User property
  };

  beforeEach(async () => {
    // Create mock query builder
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getOne: jest.fn(),
      getRawMany: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    } as any;

    // Create mock repository
    const mockRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      increment: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameLogicService,
        {
          provide: getRepositoryToken(Lyrics),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(GameRound),
          useValue: {
            create: jest.fn((round) => round),
            save: jest.fn((round) =>
              Promise.resolve({ id: 'round-1', ...round }),
            ),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(GameSession),
          useValue: {
            count: jest.fn().mockResolvedValue(0),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<GameLogicService>(GameLogicService);
    repository = module.get(getRepositoryToken(Lyrics));
    roundRepository = module.get(getRepositoryToken(GameRound));
    sessionRepository = module.get(getRepositoryToken(GameSession));
    events = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRandomLyric', () => {
    it('should return a random lyric with no filters', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      const result = await service.getRandomLyric();

      expect(result).toEqual({
        id: 1,
        lyricSnippet: 'Test lyric snippet for testing',
        songTitle: 'Test Song',
        artist: 'Test Artist',
        category: 'Pop',
        decade: '2020s',
        genre: 'Pop',
      });

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('lyrics');
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('RANDOM()');
      expect(queryBuilder.take).toHaveBeenCalledWith(1);
    });

    it('should apply category filter when provided', async () => {
      queryBuilder.getCount.mockResolvedValue(5);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ category: 'Pop' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(lyrics.category) = LOWER(:category)',
        { category: 'Pop' },
      );
    });

    it('should apply decade filter when provided', async () => {
      queryBuilder.getCount.mockResolvedValue(5);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ decade: '2020s' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.decade = :decade',
        { decade: '2020s' },
      );
    });

    it('should apply genre filter when provided', async () => {
      queryBuilder.getCount.mockResolvedValue(5);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ genre: 'Pop' });

      // Postgres has no LOWER(enum), so the column must be compared directly.
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.genre = :genre',
        { genre: Genre.Pop },
      );
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('LOWER(lyrics.genre)'),
        expect.anything(),
      );
    });

    it('should resolve genre case-insensitively to the enum value', async () => {
      queryBuilder.getCount.mockResolvedValue(5);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ genre: 'hip-hop' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.genre = :genre',
        { genre: Genre.HipHop },
      );
    });

    it('should reject an unknown genre before querying', async () => {
      await expect(service.getRandomLyric({ genre: 'Polka' })).rejects.toThrow(
        BadRequestException,
      );
      expect(queryBuilder.getCount).not.toHaveBeenCalled();
    });

    it('should only ever select active lyrics', async () => {
      queryBuilder.getCount.mockResolvedValue(5);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric();

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.isActive = :isActive',
        { isActive: true },
      );
    });

    it('should exclude specified lyric IDs', async () => {
      queryBuilder.getCount.mockResolvedValue(8);
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ excludeIds: [1, 2, 3] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.id NOT IN (:...excludeIds)',
        { excludeIds: [1, 2, 3] },
      );
    });

    it('should throw NotFoundException when no lyrics found', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service.getRandomLyric()).rejects.toThrow(
        new NotFoundException(
          'No lyrics found matching the specified criteria',
        ),
      );
    });

    it('should throw NotFoundException when query returns null', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service.getRandomLyric()).rejects.toThrow(
        new NotFoundException(
          'No lyrics found matching the specified criteria',
        ),
      );
    });

    // --- issue #175: timesUsed increment ---

    it('increments timesUsed atomically when a lyric is served', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric();

      expect(repository.increment).toHaveBeenCalledWith(
        { id: mockLyric.id },
        'timesUsed',
        1,
      );
    });

    // --- issue #175: difficulty filter ---

    it('applies difficulty filter when provided', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ difficulty: 3 });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.difficulty = :difficulty',
        { difficulty: 3 },
      );
    });

    it('does not apply difficulty filter when omitted', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric();

      const difficultyCall = (queryBuilder.andWhere as jest.Mock).mock.calls.find(
        ([sql]: [string]) => sql.includes('difficulty'),
      );
      expect(difficultyCall).toBeUndefined();
    });

    // --- issue #176: preference fallback ---

    it('falls back to preferredGenre when no explicit genre is given', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ preferredGenre: 'Pop' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.genre = :genre',
        { genre: Genre.Pop },
      );
    });

    it('falls back to preferredDecade when no explicit decade is given', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({ preferredDecade: '2020s' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.decade = :decade',
        { decade: '2020s' },
      );
    });

    it('explicit genre overrides preferredGenre', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({
        genre: Genre.HipHop,
        preferredGenre: 'Pop',
      });

      // Should use the explicit genre, not the preference
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.genre = :genre',
        { genre: Genre.HipHop },
      );
    });

    it('does not apply preferredGenre when ignorePreferences is true', async () => {
      queryBuilder.getOne.mockResolvedValue(mockLyric);

      await service.getRandomLyric({
        preferredGenre: 'Pop',
        ignorePreferences: true,
      });

      const genreCall = (queryBuilder.andWhere as jest.Mock).mock.calls.find(
        ([sql]: [string]) => sql.includes('genre'),
      );
      expect(genreCall).toBeUndefined();
    });

    it('retries without preferences when preference-filtered pool is empty', async () => {
      // First call (with preference) returns nothing; second call (without) returns a lyric
      queryBuilder.getOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockLyric);

      const result = await service.getRandomLyric({ preferredGenre: 'Pop' });

      expect(result.id).toBe(mockLyric.id);
      // Two query-builder chains were created: one with preference, one without
      expect(repository.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('never returns empty result because of preferences (acceptance criterion)', async () => {
      // Simulate: preference pool empty, but global pool has a lyric
      queryBuilder.getOne
        .mockResolvedValueOnce(null)  // preference-filtered → empty
        .mockResolvedValueOnce(mockLyric);  // no preference → hit

      const result = await service.getRandomLyric({
        preferredGenre: 'Pop',
        preferredDecade: '2020s',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(mockLyric.id);
    });
  });

  describe('rounds', () => {
    const userId = 'player-1';
    const start = new Date('2026-01-01T12:00:00.000Z');

    const openRound = (overrides: Partial<GameRound> = {}): GameRound => ({
      id: 'round-1',
      userId,
      lyricId: 1,
      sessionId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 120_000),
      answerWindowSeconds: 20,
      hintsUsed: 0,
      closedAt: null,
      ...overrides,
    });

    const guess = {
      roundId: 'round-1',
      guessType: GuessType.ARTIST,
      guessValue: 'Test Artist',
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: start });
      repository.findOne.mockResolvedValue(mockLyric);
    });

    afterEach(() => jest.useRealTimers());

    it('issues a round with the answer window and announces it', async () => {
      const round = await service.issueRound(userId, 1);

      expect(round).toMatchObject({
        id: 'round-1',
        userId,
        lyricId: 1,
        answerWindowSeconds: 20,
        hintsUsed: 0,
      });
      expect(round.issuedAt).toEqual(start);
      expect(round.expiresAt.getTime()).toBeGreaterThan(start.getTime());
      expect(events.emit).toHaveBeenCalledWith(
        'round.started',
        expect.objectContaining({
          roundId: 'round-1',
          userId,
          sessionId: null,
        }),
      );
    });

    it('only ties a round to a session the player is in', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.issueRound(userId, 1, 'session-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(roundRepository.save).not.toHaveBeenCalled();
    });

    it('scores an instant correct guess with the full speed bonus and closes the round', async () => {
      roundRepository.findOne.mockResolvedValue(openRound());
      roundRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.guessRound(userId, guess);

      expect(result).toMatchObject({
        points: 150,
        speedBonus: 50,
        timedOut: false,
      });
      expect(roundRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'round-1', userId },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'round.ended',
        expect.objectContaining({ isCorrect: true, points: 150 }),
      );
    });

    it('pays a smaller bonus the later a correct guess lands', async () => {
      roundRepository.findOne.mockResolvedValue(openRound());
      roundRepository.update.mockResolvedValue({ affected: 1 } as any);
      jest.setSystemTime(start.getTime() + 10_000); // half of the 20s window

      const result = await service.guessRound(userId, guess);

      expect(result.speedBonus).toBe(25);
      expect(result.points).toBe(125);
    });

    it('awards no points for a guess after the answer window', async () => {
      roundRepository.findOne.mockResolvedValue(openRound());
      roundRepository.update.mockResolvedValue({ affected: 1 } as any);
      jest.setSystemTime(start.getTime() + 20_001);

      const result = await service.guessRound(userId, guess);

      expect(result).toMatchObject({
        points: 0,
        speedBonus: 0,
        timedOut: true,
      });
      expect(events.emit).toHaveBeenCalledWith(
        'round.ended',
        expect.objectContaining({
          isCorrect: false,
          timedOut: true,
          points: 0,
        }),
      );
    });

    it('reduces the points a round can score by the hints used', async () => {
      roundRepository.findOne.mockResolvedValue(openRound({ hintsUsed: 2 }));
      roundRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.guessRound(userId, guess);

      expect(result.points).toBe(75); // (100 + 50) * 50%
      expect(result.hintsUsed).toBe(2);
    });

    it('rejects a replayed guess on a closed round without revealing the answer', async () => {
      roundRepository.findOne.mockResolvedValue(
        openRound({ closedAt: new Date() }),
      );

      await expect(service.guessRound(userId, guess)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('scores only one of two concurrent guesses on the same round', async () => {
      roundRepository.findOne.mockResolvedValue(openRound());
      roundRepository.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.guessRound(userId, guess)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('rejects a guess on a round that was not served to the caller', async () => {
      roundRepository.findOne.mockResolvedValue(null);

      await expect(service.guessRound('player-2', guess)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('rejects and closes an expired round', async () => {
      roundRepository.findOne.mockResolvedValue(
        openRound({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.guessRound(userId, guess)).rejects.toThrow(
        GoneException,
      );
      expect(roundRepository.update).toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    describe('hints', () => {
      beforeEach(() => {
        roundRepository.update.mockResolvedValue({ affected: 1 } as any);
      });

      it('reveals progressively more, and lowers the maximum points', async () => {
        roundRepository.findOne.mockResolvedValue(openRound({ hintsUsed: 0 }));
        const first = await service.useHint(userId, 'round-1');

        roundRepository.findOne.mockResolvedValue(openRound({ hintsUsed: 1 }));
        const second = await service.useHint(userId, 'round-1');

        roundRepository.findOne.mockResolvedValue(openRound({ hintsUsed: 2 }));
        const third = await service.useHint(userId, 'round-1');

        expect(first).toMatchObject({
          level: 1,
          decade: '2020s',
          maxPoints: 113,
        });
        expect(first.wordCount).toBeUndefined();
        expect(second).toMatchObject({
          level: 2,
          maxPoints: 75,
          wordCount: { songTitle: 2, artist: 2 },
        });
        expect(second.firstLetter).toBeUndefined();
        expect(third).toMatchObject({
          level: 3,
          hintsRemaining: 0,
          maxPoints: 38,
          firstLetter: { songTitle: 'T', artist: 'T' },
        });
        expect(roundRepository.update).toHaveBeenCalledWith(
          expect.objectContaining({ hintsUsed: 2 }),
          { hintsUsed: 3 },
        );
      });

      it('runs out of hints after the last level', async () => {
        roundRepository.findOne.mockResolvedValue(openRound({ hintsUsed: 3 }));

        await expect(service.useHint(userId, 'round-1')).rejects.toThrow(
          ConflictException,
        );
      });

      it('does not hand the same hint level to two simultaneous requests', async () => {
        roundRepository.findOne.mockResolvedValue(openRound());
        roundRepository.update.mockResolvedValue({ affected: 0 } as any);

        await expect(service.useHint(userId, 'round-1')).rejects.toThrow(
          ConflictException,
        );
      });

      it('refuses hints to a player in a wagered session', async () => {
        roundRepository.findOne.mockResolvedValue(openRound());
        sessionRepository.count.mockResolvedValue(1);

        await expect(service.useHint(userId, 'round-1')).rejects.toThrow(
          BadRequestException,
        );
        expect(roundRepository.update).not.toHaveBeenCalled();
      });

      it("refuses hints on a closed round or one that is not the caller's", async () => {
        roundRepository.findOne.mockResolvedValue(
          openRound({ closedAt: new Date() }),
        );
        await expect(service.useHint(userId, 'round-1')).rejects.toThrow(
          ConflictException,
        );

        roundRepository.findOne.mockResolvedValue(null);
        await expect(service.useHint('player-2', 'round-1')).rejects.toThrow(
          NotFoundException,
        );
      });
    });
  });

  describe('checkGuess', () => {
    const mockGuessDto: GuessDto = {
      lyricId: 1,
      guessType: GuessType.ARTIST,
      guessValue: 'Test Artist',
    };

    beforeEach(() => {
      repository.findOne.mockResolvedValue(mockLyric);
    });

    it('should return correct result for exact artist match', async () => {
      const result = await service.checkGuess(mockGuessDto);

      expect(result).toEqual({
        isCorrect: true,
        correctAnswer: 'Test Artist',
        explanation: 'Correct! This line is from "Test Song" by Test Artist.',
        points: 100,
      });

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
    });

    it('should return correct result for exact song title match', async () => {
      const songTitleGuess: GuessDto = {
        ...mockGuessDto,
        guessType: GuessType.SONG_TITLE,
        guessValue: 'Test Song',
      };

      const result = await service.checkGuess(songTitleGuess);

      expect(result).toEqual({
        isCorrect: true,
        correctAnswer: 'Test Song',
        explanation: 'Correct! This line is from "Test Song" by Test Artist.',
        points: 100,
      });
    });

    it('should handle case-insensitive matches', async () => {
      const caseInsensitiveGuess: GuessDto = {
        ...mockGuessDto,
        guessValue: 'test artist',
      };

      const result = await service.checkGuess(caseInsensitiveGuess);

      expect(result.isCorrect).toBe(true);
      expect(result.points).toBe(100);
    });

    it('should handle partial matches', async () => {
      const partialGuess: GuessDto = {
        ...mockGuessDto,
        guessValue: 'Test',
      };

      const result = await service.checkGuess(partialGuess);

      expect(result.isCorrect).toBe(true);
      expect(result.points).toBe(50);
      expect(result.explanation).toContain('Close enough!');
    });

    it('should ignore punctuation and whitespace', async () => {
      const punctuatedGuess: GuessDto = {
        ...mockGuessDto,
        guessValue: '  Test, Artist!!!  ',
      };

      const result = await service.checkGuess(punctuatedGuess);

      expect(result.isCorrect).toBe(true);
      expect(result.points).toBe(100);
    });

    it('should return incorrect result for wrong guess', async () => {
      const wrongGuess: GuessDto = {
        ...mockGuessDto,
        guessValue: 'Wrong Artist',
      };

      const result = await service.checkGuess(wrongGuess);

      expect(result).toEqual({
        isCorrect: false,
        correctAnswer: 'Test Artist',
        explanation:
          'Incorrect. The correct answer is "Test Artist" from "Test Song" by Test Artist.',
        points: 0,
      });
    });

    it('should not give partial points for very short guesses', async () => {
      const shortGuess: GuessDto = {
        ...mockGuessDto,
        guessValue: 'Te',
      };

      const result = await service.checkGuess(shortGuess);

      expect(result.isCorrect).toBe(false);
      expect(result.points).toBe(0);
    });

    it('should throw NotFoundException when lyric not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.checkGuess(mockGuessDto)).rejects.toThrow(
        new NotFoundException('Lyric with ID 1 not found'),
      );
    });

    it('should return 404 for a deactivated lyric', async () => {
      // findOne filters on isActive, so a deactivated row comes back as null.
      repository.findOne.mockImplementation(async (opts: any) =>
        opts.where.isActive === true ? null : { ...mockLyric, isActive: false },
      );

      await expect(service.checkGuess(mockGuessDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMultipleRandomLyrics', () => {
    it('should return multiple unique lyrics', async () => {
      const mockLyrics = [
        { ...mockLyric, id: 1 },
        { ...mockLyric, id: 2 },
        { ...mockLyric, id: 3 },
      ];

      queryBuilder.getCount
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(9)
        .mockResolvedValueOnce(8);

      queryBuilder.getOne
        .mockResolvedValueOnce(mockLyrics[0])
        .mockResolvedValueOnce(mockLyrics[1])
        .mockResolvedValueOnce(mockLyrics[2]);

      const result = await service.getMultipleRandomLyrics(3);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });

    it('should handle case when not enough lyrics available', async () => {
      queryBuilder.getCount
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      queryBuilder.getOne
        .mockResolvedValueOnce({ ...mockLyric, id: 1 })
        .mockResolvedValueOnce({ ...mockLyric, id: 2 });

      const result = await service.getMultipleRandomLyrics(5);

      expect(result).toHaveLength(2);
    });
  });

  describe('getLyricStats', () => {
    it('should return statistics about available lyrics', async () => {
      queryBuilder.getCount.mockResolvedValue(100);
      queryBuilder.getRawMany
        .mockResolvedValueOnce([{ category: 'Pop' }, { category: 'Rock' }])
        .mockResolvedValueOnce([{ decade: '2020s' }, { decade: '2010s' }])
        .mockResolvedValueOnce([{ genre: 'Pop' }, { genre: 'Rock' }]);

      const result = await service.getLyricStats();

      expect(result).toEqual({
        totalCount: 100,
        availableCategories: ['Pop', 'Rock'],
        availableDecades: ['2020s', '2010s'],
        availableGenres: ['Pop', 'Rock'],
      });
    });

    it('should filter out null values from categories', async () => {
      queryBuilder.getCount.mockResolvedValue(50);
      queryBuilder.getRawMany
        .mockResolvedValueOnce([{ category: 'Pop' }, { category: null }])
        .mockResolvedValueOnce([{ decade: '2020s' }])
        .mockResolvedValueOnce([{ genre: 'Pop' }]);

      const result = await service.getLyricStats();

      expect(result.availableCategories).toEqual(['Pop']);
    });

    it('should compare genre directly and count only active lyrics', async () => {
      queryBuilder.getCount.mockResolvedValue(3);
      queryBuilder.getRawMany.mockResolvedValue([]);

      await service.getLyricStats({ genre: 'pop' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lyrics.genre = :genre',
        { genre: Genre.Pop },
      );
      // One for the count query plus one for each DISTINCT list.
      const activeFilters = queryBuilder.andWhere.mock.calls.filter(
        ([sql]) => sql === 'lyrics.isActive = :isActive',
      );
      expect(activeFilters).toHaveLength(4);
    });
  });

  describe('validateGuess', () => {
    it('should return valid for reasonable guess', () => {
      const result = service.validateGuess('Test Artist');

      expect(result).toEqual({ isValid: true });
    });

    it('should return invalid for empty guess', () => {
      const result = service.validateGuess('');

      expect(result).toEqual({
        isValid: false,
        reason: 'Guess cannot be empty',
      });
    });

    it('should return invalid for null/undefined guess', () => {
      expect(service.validateGuess(null as any)).toEqual({
        isValid: false,
        reason: 'Guess cannot be empty',
      });

      expect(service.validateGuess(undefined as any)).toEqual({
        isValid: false,
        reason: 'Guess cannot be empty',
      });
    });

    it('should return invalid for whitespace-only guess', () => {
      const result = service.validateGuess('   ');

      expect(result).toEqual({
        isValid: false,
        reason: 'Guess cannot be empty',
      });
    });

    it('should return invalid for too long guess', () => {
      const longGuess = 'a'.repeat(201);
      const result = service.validateGuess(longGuess);

      expect(result).toEqual({
        isValid: false,
        reason: 'Guess is too long (max 200 characters)',
      });
    });

    it('should accept guess at maximum length', () => {
      const maxLengthGuess = 'a'.repeat(200);
      const result = service.validateGuess(maxLengthGuess);

      expect(result).toEqual({ isValid: true });
    });
  });

  describe('normalizeString', () => {
    it('should normalize strings correctly', () => {
      // Access private method for testing
      const normalize = (service as any).normalizeString;

      expect(normalize('Test Artist')).toBe('test artist');
      expect(normalize('  Test Artist  ')).toBe('test artist');
      expect(normalize('Test, Artist!')).toBe('test artist');
      expect(normalize('Test   Artist')).toBe('test artist');
      expect(normalize('TEST ARTIST')).toBe('test artist');
      expect(normalize('')).toBe('');
      expect(normalize(null)).toBe('');
    });
  });

  describe('error handling', () => {
    it('should handle database errors in getRandomLyric', async () => {
      queryBuilder.getOne.mockRejectedValue(new Error('Database error'));

      await expect(service.getRandomLyric()).rejects.toThrow('Database error');
    });

    it('should handle database errors in checkGuess', async () => {
      repository.findOne.mockRejectedValue(new Error('Database error'));

      const guessDto: GuessDto = {
        lyricId: 1,
        guessType: GuessType.ARTIST,
        guessValue: 'Test Artist',
      };

      await expect(service.checkGuess(guessDto)).rejects.toThrow(
        'Database error',
      );
    });

    it('should handle database errors in getLyricStats', async () => {
      queryBuilder.getCount.mockRejectedValue(new Error('Database error'));

      await expect(service.getLyricStats()).rejects.toThrow('Database error');
    });
  });
});
