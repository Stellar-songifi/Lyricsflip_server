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
      expect(mockCacheManager.set).toHaveBeenCalledWith('lyrics:1', mockLyrics, cacheConfig.lyricsTtlMs);
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
        cacheConfig.randomLyricsTtlMs,
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
      expect(mockCacheManager.set).toHaveBeenCalledWith('lyrics_by_genre:Pop', [mockLyrics], cacheConfig.lyricsTtlMs);
    });
  });

  describe('cache invalidation (against a working in-memory cache)', () => {
    let store: Map<string, unknown>;
    let row: Lyrics;
    let svc: LyricsService;

    beforeEach(() => {
      store = new Map();
      row = { ...mockLyrics, isActive: true, artist: 'Old Artist' } as Lyrics;

      const cache = {
        get: jest.fn(async (key: string) => store.get(key)),
        set: jest.fn(async (key: string, value: unknown) => {
          store.set(key, value);
        }),
        del: jest.fn(async (key: string) => {
          store.delete(key);
        }),
      };

      // A tiny fake table holding one lyric, so reads reflect writes.
      const active = () => (row.isActive ? [{ ...row }] : []);
      const repo = {
        findOne: jest.fn(async ({ where }: any) =>
          where.id === row.id && row.isActive ? { ...row } : null,
        ),
        find: jest.fn(async () => active()),
        save: jest.fn(async (lyric: Lyrics) => {
          row = { ...lyric };
          return { ...row };
        }),
        createQueryBuilder: jest.fn(() => {
          const qb: any = {};
          for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'limit']) {
            qb[m] = () => qb;
          }
          qb.getCount = async () => active().length;
          qb.getMany = async () => active();
          return qb;
        }),
      };

      svc = new LyricsService(repo as any, cache as any);
    });

    const readAll = async () => ({
      one: await svc.findOne(1),
      category: await svc.getLyricsByCategory('genre', 'Pop'),
      random: await svc.getRandomLyrics(1, 'Pop'),
    });

    it('serves the new data from every read after an update', async () => {
      const before = await readAll();
      expect(before.one.artist).toBe('Old Artist');
      expect(store.size).toBe(3);

      await svc.update(1, { artist: 'New Artist' } as UpdateLyricsDto, mockUser);

      const after = await readAll();
      expect(after.one.artist).toBe('New Artist');
      expect(after.category[0].artist).toBe('New Artist');
      expect(after.random[0].artist).toBe('New Artist');
    });

    it('stops serving a lyric from every read after it is removed', async () => {
      await readAll();

      await svc.remove(1);

      await expect(svc.findOne(1)).rejects.toThrow('Lyrics not found');
      expect(await svc.getLyricsByCategory('genre', 'Pop')).toEqual([]);
      expect(await svc.getRandomLyrics(1, 'Pop')).toEqual([]);
    });

    it('clearCache empties every lyrics entry and reports how many', async () => {
      await readAll();

      const result = await svc.clearCache();

      expect(result).toEqual({ cleared: 3 });
      expect(store.size).toBe(0);
      expect((await svc.getCacheStats()).keys).toBe(0);
    });

    it('does not re-cache data loaded before a concurrent write', async () => {
      // Hold the DB read open, invalidate, then let the stale read finish.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const staleRow = { ...row };
      (svc as any).lyricsRepository.findOne = jest.fn(async () => {
        await gate;
        return staleRow;
      });

      const pending = svc.findOne(1);
      await svc.clearCache();
      release();
      await pending;

      expect(store.has('lyrics:1')).toBe(false);
    });

    it('getCacheStats reports real key counts by type', async () => {
      await readAll();
      await svc.searchLyrics('test');

      expect(await svc.getCacheStats()).toEqual({
        keys: 4,
        keysByType: { lyrics: 1, random: 1, category: 1, search: 1 },
        ttlMs: cacheConfig.lyricsTtlMs,
      });
    });

    it('getCacheStats stops counting entries once their TTL has passed', async () => {
      jest.useFakeTimers();
      try {
        await svc.getRandomLyrics(1, 'Pop');
        expect((await svc.getCacheStats()).keys).toBe(1);

        jest.advanceTimersByTime(cacheConfig.randomLyricsTtlMs + 1);

        expect((await svc.getCacheStats()).keys).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
