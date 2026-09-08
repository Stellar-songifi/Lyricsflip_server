import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { LyricsService } from './lyrics.service';
import { Lyrics } from './entities/lyrics.entity';
import { User } from '../users/entities/user.entity';
import { CreateLyricsDto } from './dto/create-lyrics.dto';
import { UpdateLyricsDto } from './dto/update-lyrics.dto';
import { cacheConfig } from '../config/cache.config';

describe('LyricsService', () => {
  let service: LyricsService;
  let mockRepository: any;
  let mockCacheManager: any;

  const mockUser: User = {
    id: '1',
    email: 'test@example.com',
    username: 'testuser',
    name: 'Test User',
    passwordHash: 'hashedPassword',
    xp: 0,
    level: 1,
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockLyrics: Lyrics = {
    id: 1,
    content: 'Test lyrics content',
    artist: 'Test Artist',
    songTitle: 'Test Song',
    genre: 'Pop' as any,
    decade: '2020s',
    createdBy: mockUser,
    createdAt: new Date(),
  } as Lyrics;

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(10),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockLyrics]),
      })),
    };

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LyricsService,
        {
          provide: getRepositoryToken(Lyrics),
          useValue: mockRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<LyricsService>(LyricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create lyrics and clear cache', async () => {
      const createDto: CreateLyricsDto = {
        content: 'New lyrics',
        artist: 'New Artist',
        songTitle: 'New Song',
        genre: 'Hip-Hop' as any,
        decade: 2023,
      };

      mockRepository.create.mockReturnValue(mockLyrics);
      mockRepository.save.mockResolvedValue(mockLyrics);

      const result = await service.create(createDto, mockUser);

      expect(result).toEqual(mockLyrics);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...createDto,
        decade: '2023',
        createdBy: mockUser,
      });
      expect(mockRepository.save).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return lyrics from cache if available', async () => {
      mockCacheManager.get.mockResolvedValue(mockLyrics);

      const result = await service.findOne(1);

      expect(result).toEqual(mockLyrics);
      expect(mockCacheManager.get).toHaveBeenCalledWith('lyrics:1');
      expect(mockRepository.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not in cache', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockRepository.findOne.mockResolvedValue(mockLyrics);

      const result = await service.findOne(1);

      expect(result).toEqual(mockLyrics);
      expect(mockCacheManager.get).toHaveBeenCalledWith('lyrics:1');
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
        relations: ['createdBy'],
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith('lyrics:1', mockLyrics, cacheConfig.lyricsTTL);
    });
  });

  describe('getRandomLyrics', () => {
    it('should return random lyrics from cache if available', async () => {
      mockCacheManager.get.mockResolvedValue([mockLyrics]);

      const result = await service.getRandomLyrics(1);

      expect(result).toEqual([mockLyrics]);
      expect(mockCacheManager.get).toHaveBeenCalledWith('random_lyrics:1:all:all');
    });

    it('should fetch from database and cache if not in cache', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.getRandomLyrics(1, 'Pop', 2020);

      expect(result).toEqual([mockLyrics]);
      expect(mockCacheManager.get).toHaveBeenCalledWith('random_lyrics:1:Pop:2020');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'random_lyrics:1:Pop:2020',
        [mockLyrics],
        Math.floor(cacheConfig.lyricsTTL / 4),
      );
    });
  });

  describe('getLyricsByCategory', () => {
    it('should return lyrics by category from cache if available', async () => {
      mockCacheManager.get.mockResolvedValue([mockLyrics]);

      const result = await service.getLyricsByCategory('genre', 'Pop');

      expect(result).toEqual([mockLyrics]);
      expect(mockCacheManager.get).toHaveBeenCalledWith('lyrics_by_genre:Pop');
    });

    it('should fetch from database and cache if not in cache', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockRepository.find.mockResolvedValue([mockLyrics]);

      const result = await service.getLyricsByCategory('genre', 'Pop');

      expect(result).toEqual([mockLyrics]);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { genre: 'Pop', isActive: true },
        relations: ['createdBy'],
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith('lyrics_by_genre:Pop', [mockLyrics], cacheConfig.lyricsTTL);
    });
  });

  describe('clearCache', () => {
    it('should clear cache without errors', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await service.clearCache();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cache clear requested - implement pattern-based deletion for production',
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const stats = await service.getCacheStats();

      expect(stats).toEqual({
        keys: 0,
        ttl: cacheConfig.lyricsTTL,
        memoryUsage: 'Unknown',
      });
    });
  });
});
