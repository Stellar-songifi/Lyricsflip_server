import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { User, MusicGenre, MusicDecade, UserLevel } from './entities/user.entity';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '../auth/roles/role.enum';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import { cacheConfig } from '../config/cache.config';
import * as bcrypt from 'bcrypt';
import { TokenRevocationService } from '../auth/token-revocation.service';
import { TOKEN_SERVICE } from '../tokens/interfaces/token.interface';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

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
    createQueryBuilder: jest.fn(),
    query: jest.fn(),
  };

  const mockWagerRepository = {
    findOne: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockTokenService = {
    getUserBalance: jest.fn().mockResolvedValue('0'),
  };

  const mockTokenRevocationService = {
    revokeAllForUser: jest.fn(),
    revokeAllUserTokens: jest.fn(),
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
        {
          provide: TokenRevocationService,
          useValue: mockTokenRevocationService,
        },
        {
          provide: TOKEN_SERVICE,
          useValue: mockTokenService,
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

  describe('deleteAccount', () => {
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

    it('throws UnauthorizedException and changes nothing when the password is wrong', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const removeSpy = jest.spyOn(service, 'remove');

      await expect(
        service.deleteAccount('user-123', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);

      expect(removeSpy).not.toHaveBeenCalled();
      expect(mockUserRepository.save).not.toHaveBeenCalled();
      expect(mockUserRepository.remove).not.toHaveBeenCalled();
      expect(
        mockTokenRevocationService.revokeAllForUser,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.deleteAccount('missing', 'password'),
      ).rejects.toThrow(NotFoundException);
    });

    it('verifies the password, anonymizes the user and revokes tokens', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockWagerRepository.findOne.mockResolvedValue(null);
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      const result = await service.deleteAccount('user-123', 'correct-password');

      expect(bcrypt.compare).toHaveBeenCalledWith(
        'correct-password',
        mockUser.passwordHash,
      );
      expect(mockUserRepository.save).toHaveBeenCalled();
      const saved = mockUserRepository.save.mock.calls[0][0];
      expect(saved.isActive).toBe(false);
      expect(
        mockTokenRevocationService.revokeAllForUser,
      ).toHaveBeenCalledWith('user-123');
      expect(result.message).toContain('deactivated');
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
      });

      const result = await service.updatePreferences('user-123', updateDto);

      expect(result.preferredGenre).toBe(MusicGenre.JAZZ);
      expect(result.preferredDecade).toBe(mockUser.preferredDecade);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updatePreferences('missing', {
          preferredGenre: MusicGenre.ROCK,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('leaderboard ranking with ties', () => {
    const buildUser = (id: string, xp: number): User => ({
      id,
      email: `${id}@example.com`,
      username: id,
      name: id,
      passwordHash: 'hashedpassword',
      xp,
      level: 1,
      levelTitle: UserLevel.GOSSIP_ROOKIE,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: Role.User,
      isActive: true,
      mockBalance: '0',
      preferredGenre: undefined,
      preferredDecade: undefined,
      gameSessions: [],
    });

    const mockQueryBuilder = (rows: Array<{ id: string; xp: number; rank: string }>) => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: rows.map((r) => buildUser(r.id, r.xp)),
          raw: rows.map((r) => ({ user_id: r.id, rank: r.rank })),
        }),
        getRawOne: jest.fn().mockResolvedValue(rows[0] ? { rank: rows[0].rank } : undefined),
      };
      mockUserRepository.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('assigns the same competition rank to tied users on the page', async () => {
      mockQueryBuilder([
        { id: 'a', xp: 600, rank: '1' },
        { id: 'b', xp: 500, rank: '2' },
        { id: 'c', xp: 500, rank: '2' },
        { id: 'd', xp: 500, rank: '2' },
        { id: 'e', xp: 400, rank: '5' },
      ]);

      const result = await service.getLeaderboard({ limit: 5, offset: 0 } as any);

      const ranks = result.data.map((u: any) => u.rank);
      expect(ranks).toEqual([1, 2, 2, 2, 5]);
    });

    it('keeps tied users sharing a rank across a page boundary', async () => {
      mockQueryBuilder([
        { id: 'c', xp: 500, rank: '2' },
        { id: 'd', xp: 500, rank: '2' },
        { id: 'e', xp: 400, rank: '5' },
      ]);

      const result = await service.getLeaderboard({ limit: 3, offset: 2 } as any);

      const ranks = result.data.map((u: any) => u.rank);
      expect(ranks).toEqual([2, 2, 5]);
    });

    it('reports the same rank in myRank as in the list for a tied user', async () => {
      mockQueryBuilder([{ id: 'c', xp: 500, rank: '2' }]);

      const result = await service.getMyRank('c');

      expect(result.rank).toBe(2);
    });
  });
});
