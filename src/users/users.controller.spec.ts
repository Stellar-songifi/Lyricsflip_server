import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    getLeaderboard: jest.Mock;
    updatePreferences: jest.Mock;
    getUserPreferences: jest.Mock;
    getPublicProfile: jest.Mock;
    getSelfProfile: jest.Mock;
    deleteAccount: jest.Mock;
    findByUsername: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      getLeaderboard: jest.fn(),
      updatePreferences: jest.fn(),
      getUserPreferences: jest.fn(),
      getPublicProfile: jest.fn(),
      getSelfProfile: jest.fn(),
      deleteAccount: jest.fn(),
      findByUsername: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPublicProfile', () => {
    it('returns only deliberately public fields', async () => {
      const publicProfile = {
        username: 'alice',
        level: 5,
        levelTitle: 'Veteran',
        xp: 1200,
        achievements: ['first-win'],
        winRate: 0.75,
      };
      usersService.getPublicProfile.mockResolvedValue(publicProfile);

      const result = await controller.getPublicProfile('alice');

      expect(usersService.getPublicProfile).toHaveBeenCalledWith('alice');
      expect(result).toEqual(publicProfile);
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('wallet');
      expect(result).not.toHaveProperty('id');
    });
  });

  describe('findOne', () => {
    it('delegates to the service for admin access', async () => {
      const user = { id: '1', username: 'alice' };
      usersService.findOne.mockResolvedValue(user);

      const result = await controller.findOne('1');

      expect(usersService.findOne).toHaveBeenCalledWith('1');
      expect(result).toEqual(user);
    });
  });

  describe('getSelfProfile', () => {
    it('delegates to the service with the authenticated user id', async () => {
      const profile = { id: '1', username: 'alice', email: 'a@example.com' };
      usersService.getSelfProfile.mockResolvedValue(profile);

      const result = await controller.getSelfProfile({ user: { id: '1' } });

      expect(usersService.getSelfProfile).toHaveBeenCalledWith('1');
      expect(result).toEqual(profile);
    });
  });

  describe('findByUsername', () => {
    it('delegates to the service', async () => {
      const profile = { username: 'alice', level: 5 };
      usersService.findByUsername.mockResolvedValue(profile);

      const result = await controller.findByUsername('alice');

      expect(usersService.findByUsername).toHaveBeenCalledWith('alice');
      expect(result).toEqual(profile);
    });
  });

  describe('getLeaderboard', () => {
    it('passes an options object to the service', async () => {
      const leaderboard = { entries: [], myRank: 3 };
      usersService.getLeaderboard.mockResolvedValue(leaderboard);

      const result = await controller.getLeaderboard(
        { limit: 10, offset: 0 },
        { user: { id: '1' } },
      );

      expect(usersService.getLeaderboard).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        userId: '1',
      });
      expect(result).toEqual(leaderboard);
    });

    it('works without an authenticated user', async () => {
      const leaderboard = { entries: [] };
      usersService.getLeaderboard.mockResolvedValue(leaderboard);

      const result = await controller.getLeaderboard({ limit: 10, offset: 0 }, {});

      expect(usersService.getLeaderboard).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        userId: undefined,
      });
      expect(result).toEqual(leaderboard);
    });
  });

  describe('removeMe', () => {
    it('forwards the password to deleteAccount', async () => {
      usersService.deleteAccount.mockResolvedValue({ message: 'Account deleted' });

      const result = await controller.removeMe(
        { user: { id: '1' } },
        { password: 'secret' },
      );

      expect(usersService.deleteAccount).toHaveBeenCalledWith('1', {
        password: 'secret',
        transaction: undefined,
      });
      expect(result).toEqual({ message: 'Account deleted' });
    });

    it('surfaces a wrong password as 401', async () => {
      const unauthorized = new UnauthorizedException('Invalid password');
      usersService.deleteAccount.mockRejectedValue(unauthorized);

      await expect(
        controller.removeMe({ user: { id: '1' } }, { password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
