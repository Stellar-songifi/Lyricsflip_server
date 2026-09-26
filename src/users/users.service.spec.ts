import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { User, MusicGenre, MusicDecade, UserLevel } from './entities/user.entity';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Role } from '../auth/roles/role.enum';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import { cacheConfig } from '../config/cache.config';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: Repository<User>;
  let cacheManager: Cache;

  const mockUserRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    findAndCount: jest.fn(),
  };

  const mockWagerRepository = {
    findOne: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Wager),
          useValue: mockWagerRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    cacheManager = module.get<Cache>(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('remove', () => {
    const mockUser: User = {
      id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      name: 'Test User',
      passwordHash: 'hashedpassword',
      xp: 100,
      level: 2,
      levelTitle: UserLevel.GOSSIP_ROOKIE,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: Role.User,
      isActive: true,
      mockBalance: '1000000000',
      preferredGenre: undefined,
      preferredDecade: undefined,
      gameSessions: [],
    };

    it('soft-deletes and anonymizes the user when no wager is active', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      mockWagerRepository.findOne.mockResolvedValue(null);
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      const result = await service.remove('user-123');

      expect(mockUserRepository.remove).not.toHaveBeenCalled();
      const saved = mockUserRepository.save.mock.calls[0][0];
      expect(saved.isActive).toBe(false);
      expect(saved.email).toContain('deleted-user-123');
      expect(saved.username).toBe('deleted_user-123');
      expect(result.message).toContain('deactivated');
    });

    it('throws ConflictException when the user has a non-terminal wager', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      mockWagerRepository.findOne.mockResolvedValue({
        id: 'wager-1',
        status: WagerStatus.STAKED,
      });

      await expect(service.remove('user-123')).rejects.toThrow(
        ConflictException,
      );
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updatePreferences', () => {
    const mockUser: User = {
      id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      name: 'Test User',
      passwordHash: 'hashedpassword',
      xp: 100,
      level: 2,
      levelTitle: UserLevel.GOSSIP_ROOKIE,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: Role.User,
      isActive: true,
      mockBalance: '1000000000',
      preferredGenre: undefined,
      preferredDecade: undefined,
      gameSessions: [],
    };

    it('should update user preferences successfully', async () => {
      const updateDto: UpdateUserPreferencesDto = {
        preferredGenre: MusicGenre.ROCK,
        preferredDecade: MusicDecade.EIGHTIES,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        preferredGenre: MusicGenre.ROCK,
        preferredDecade: MusicDecade.EIGHTIES,
      });

      const result = await service.updatePreferences('user-123', updateDto);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 'user-123' } });
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(mockCacheManager.del).toHaveBeenCalledWith('user:user-123');
      expect(result.preferredGenre).toBe(MusicGenre.ROCK);
      expect(result.preferredDecade).toBe(MusicDecade.EIGHTIES);
    });

    it('should update only provided preferences', async () => {
      const updateDto: UpdateUserPreferencesDto = {
        preferredGenre: MusicGenre.JAZZ,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        preferredGenre: MusicGenre.JAZZ,
        // Keep the original decade value
        preferredDecade: mockUser.preferredDecade,
      });

      const result = await service.updatePreferences('user-123', updateDto);

      expect(result.preferredGenre).toBe(MusicGenre.JAZZ);
      expect(result.preferredDecade).toBe(mockUser.preferredDecade);
    });

    it('should throw NotFoundException if user not found', async () => {
      const updateDto: UpdateUserPreferencesDto = {
        preferredGenre: MusicGenre.ROCK,
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.updatePreferences('nonexistent', updateDto))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('getUserPreferences', () => {
    const mockUser = {
      preferredGenre: MusicGenre.POP,
      preferredDecade: MusicDecade.NINETIES,
    };

    it('should return user preferences successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getUserPreferences('user-123');

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: ['preferredGenre', 'preferredDecade'],
      });
      expect(result).toEqual({
        preferredGenre: MusicGenre.POP,
        preferredDecade: MusicDecade.NINETIES,
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserPreferences('nonexistent'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('getLeaderboard', () => {
    it('should return cached leaderboard if available', async () => {
      const cachedData = { data: [], meta: {} };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await service.getLeaderboard(10, 0, 'xp', 'DESC');

      expect(mockCacheManager.get).toHaveBeenCalledWith('leaderboard:xp:DESC:10:0');
      expect(result).toEqual(cachedData);
    });

    it('should fetch from database and cache if not cached', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockUserRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getLeaderboard(10, 0, 'xp', 'DESC');

      expect(mockUserRepository.findAndCount).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should cache the leaderboard for 30 seconds (TTL in milliseconds)', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockUserRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.getLeaderboard(10, 0, 'xp', 'DESC');

      // cache-manager v7 TTLs are milliseconds; 30 would expire in 30 ms.
      expect(cacheConfig.leaderboardTtlMs).toBe(30_000);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'leaderboard:xp:DESC:10:0',
        expect.any(Object),
        30_000,
      );
    });

    it('should throw BadRequestException for invalid limit', async () => {
      await expect(service.getLeaderboard(-1, 0, 'xp', 'DESC'))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid sort field', async () => {
      await expect(service.getLeaderboard(10, 0, 'invalid', 'DESC'))
        .rejects
        .toThrow(BadRequestException);
    });
  });
});
