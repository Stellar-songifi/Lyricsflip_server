import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Role } from '../roles/role.enum';

describe('AuthService refresh token flow', () => {
  let service: AuthService;

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const mockRefreshTokenRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((data) => data),
    update: jest.fn(),
    query: jest.fn(),
  };
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('signed-jwt'),
  };

  const baseUser: User = {
    id: 'user-1',
    email: 'a@b.com',
    username: 'alice',
    name: null,
    passwordHash: 'hash',
    xp: 0,
    level: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: Role.User,
    isActive: true,
    mockBalance: '0',
    tokenVersion: 0,
    gameSessions: [],
  } as unknown as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokenRepository,
        },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockRefreshTokenRepository.create.mockImplementation((data) => data);
  });

  describe('refresh', () => {
    it('rejects an unknown token', async () => {
      mockRefreshTokenRepository.findOne.mockResolvedValue(null);
      await expect(service.refresh('nope')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a revoked token', async () => {
      mockRefreshTokenRepository.findOne.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        userId: 'user-1',
      });
      await expect(service.refresh('used')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      mockRefreshTokenRepository.findOne.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10000),
        userId: 'user-1',
      });
      await expect(service.refresh('stale')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates a valid token and returns a new pair', async () => {
      const existing = {
        id: 'token-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        userId: 'user-1',
        familyId: 'family-1',
      };
      mockRefreshTokenRepository.findOne.mockResolvedValue(existing);
      mockUserRepository.findOne.mockResolvedValue({ ...baseUser });
      mockRefreshTokenRepository.query.mockResolvedValue([{ id: 'token-1' }]);
      mockRefreshTokenRepository.save.mockImplementation((t) =>
        Promise.resolve(t),
      );

      const result = await service.refresh('good-token');

      expect(mockRefreshTokenRepository.query).toHaveBeenCalled();
      expect(result.accessToken).toBe('signed-jwt');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken).not.toBe('good-token');
    });

    it('issues exactly one new pair for two parallel refreshes with one token', async () => {
      const existing = {
        id: 'token-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        userId: 'user-1',
        familyId: 'family-1',
      };
      mockRefreshTokenRepository.findOne.mockResolvedValue(existing);
      mockUserRepository.findOne.mockResolvedValue({ ...baseUser });
      mockRefreshTokenRepository.save.mockImplementation((t) =>
        Promise.resolve(t),
      );
      // Conditional UPDATE succeeds only for the first caller.
      mockRefreshTokenRepository.query
        .mockResolvedValueOnce([{ id: 'token-1' }])
        .mockResolvedValueOnce([]);

      const results = await Promise.allSettled([
        service.refresh('good-token'),
        service.refresh('good-token'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('revokes the whole family, bumps tokenVersion and audits on replay of a rotated token', async () => {
      mockRefreshTokenRepository.findOne.mockResolvedValue({
        id: 'token-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        userId: 'user-1',
        familyId: 'family-1',
      });
      mockUserRepository.findOne.mockResolvedValue({ ...baseUser });
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));
      mockRefreshTokenRepository.query.mockResolvedValue([]);

      await expect(service.refresh('rotated-token')).rejects.toThrow(
        UnauthorizedException,
      );

      // Family-wide revocation issued.
      const revokeCall = mockRefreshTokenRepository.query.mock.calls.find(
        ([sql]) => /family_id/i.test(sql),
      );
      expect(revokeCall).toBeDefined();

      // tokenVersion bumped.
      expect(mockUserRepository.save).toHaveBeenCalled();
      const saved = mockUserRepository.save.mock.calls[0][0];
      expect(saved.tokenVersion).toBe(baseUser.tokenVersion + 1);

      // Security audit event written.
      const auditCall = mockRefreshTokenRepository.query.mock.calls.find(
        ([sql]) => /audit/i.test(sql),
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe('logout', () => {
    it('revokes the presented token', async () => {
      await service.logout('some-token');
      expect(mockRefreshTokenRepository.update).toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('bumps tokenVersion and revokes refresh tokens on success', async () => {
      const bcrypt = require('bcrypt');
      const currentHash = await bcrypt.hash('OldPass1', 12);
      mockUserRepository.findOne.mockResolvedValue({
        ...baseUser,
        passwordHash: currentHash,
        tokenVersion: 0,
      });
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      await service.changePassword('user-1', {
        currentPassword: 'OldPass1',
        newPassword: 'NewPass1',
      });

      const saved = mockUserRepository.save.mock.calls[0][0];
      expect(saved.tokenVersion).toBe(1);
      expect(mockRefreshTokenRepository.update).toHaveBeenCalled();
    });

    it('rejects an incorrect current password', async () => {
      const bcrypt = require('bcrypt');
      const currentHash = await bcrypt.hash('OldPass1', 12);
      mockUserRepository.findOne.mockResolvedValue({
        ...baseUser,
        passwordHash: currentHash,
      });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'WrongPass1',
          newPassword: 'NewPass1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
