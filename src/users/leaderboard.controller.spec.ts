import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const leaderboardMock = {
  data: [
    { id: '1', username: 'alice', xp: 100, level: 2, rank: 1 },
    { id: '2', username: 'bob', xp: 80, level: 1, rank: 2 },
  ],
  meta: { total: 2, limit: 2, offset: 0, sort: 'xp', order: 'DESC' },
};

describe('UsersController - Leaderboard', () => {
  let controller: UsersController;
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            getLeaderboard: jest.fn().mockResolvedValue(leaderboardMock),
          },
        },
      ],
    }).compile();
    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  it('should return leaderboard from controller', async () => {
    const result = await controller.getLeaderboard({ limit: 2, offset: 0 });
    expect(result).toEqual(leaderboardMock);
    expect(service.getLeaderboard).toHaveBeenCalledWith(2, 0, 'xp', 'DESC');
  });
});
