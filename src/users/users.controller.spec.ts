import { Test, TestingModule } from '@nestjs/testing';
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
});
