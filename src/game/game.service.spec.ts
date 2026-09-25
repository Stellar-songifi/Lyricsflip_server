import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Genre, Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameLogicService, GuessDto } from './game.service';
import { GuessType } from './dto/guess.dto';
import { GameRound } from './entities/game-round.entity';
import { User } from 'src/users/entities/user.entity';

describe('GameLogicService', () => {
  let service: GameLogicService;
  let repository: jest.Mocked<Repository<Lyrics>>;
  let roundRepository: jest.Mocked<Repository<GameRound>>;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<Lyrics>>;

  const mockLyric: Lyrics = {
    id: 1,
    lyricSnippet: 'Test lyric snippet for testing',
    songTitle: 'Test Song',
    artist: 'Test Artist',
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
      ],
    }).compile();

    service = module.get<GameLogicService>(GameLogicService);
    repository = module.get(getRepositoryToken(Lyrics));
    roundRepository = module.get(getRepositoryToken(GameRound));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRandomLyric', () => {
    it('should return a random lyric with no filters', async () => {
      queryBuilder.getCount.mockResolvedValue(10);
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
      expect(queryBuilder.getCount).toHaveBeenCalled();
      expect(queryBuilder.skip).toHaveBeenCalledWith(expect.any(Number));
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

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(lyrics.genre) = LOWER(:genre)',
        { genre: 'Pop' },
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
      queryBuilder.getCount.mockResolvedValue(0);

      await expect(service.getRandomLyric()).rejects.toThrow(
        new NotFoundException(
          'No lyrics found matching the specified criteria',
        ),
      );
    });

    it('should throw NotFoundException when query returns null', async () => {
      queryBuilder.getCount.mockResolvedValue(10);
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service.getRandomLyric()).rejects.toThrow(
        new NotFoundException('Failed to fetch random lyric'),
      );
    });
  });

  describe('rounds', () => {
    const userId = 'player-1';

    const openRound = (overrides: Partial<GameRound> = {}): GameRound => ({
      id: 'round-1',
      userId,
      lyricId: 1,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      closedAt: null,
      ...overrides,
    });

    const guess = {
      roundId: 'round-1',
      guessType: GuessType.ARTIST,
      guessValue: 'Test Artist',
    };

    beforeEach(() => {
      repository.findOne.mockResolvedValue(mockLyric);
    });

    it('issues a round for the player and lyric with an expiry', async () => {
      const round = await service.issueRound(userId, 1);

      expect(round).toMatchObject({ id: 'round-1', userId, lyricId: 1 });
      expect(round.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('scores a guess against the served lyric and closes the round', async () => {
      roundRepository.findOne.mockResolvedValue(openRound());
      roundRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.guessRound(userId, guess);

      expect(result.points).toBe(100);
      expect(roundRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'round-1', userId },
      });
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
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
      // The lookup is scoped to the caller, so another player's round, or a
      // lyric never served, finds nothing.
      roundRepository.findOne.mockResolvedValue(null);

      await expect(service.guessRound('player-2', guess)).rejects.toThrow(
        NotFoundException,
      );
      expect(roundRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'round-1', userId: 'player-2' },
      });
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
        where: { id: 1 },
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
      queryBuilder.getCount.mockRejectedValue(new Error('Database error'));

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
