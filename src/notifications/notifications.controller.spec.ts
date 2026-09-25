import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/roles/role.enum';
import { NotificationsService } from './notifications.service';
import { 
  CreateLevelUpNotificationDto, 
  CreateChallengeNotificationDto, 
  CreateAchievementNotificationDto 
} from './dto/create-notification.dto';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let devController: NotificationsDevController;
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController, NotificationsDevController],
      providers: [
        {
          provide: NotificationsService,
          useValue: {
            emitLevelUpEvent: jest.fn(),
            emitChallengeCompletedEvent: jest.fn(),
            emitAchievementEvent: jest.fn(),
            generateMockNotifications: jest.fn(),
            getAllNotifications: jest.fn(),
            getNotificationsForUser: jest.fn(),
            clearNotifications: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    devController = module.get<NotificationsDevController>(NotificationsDevController);
    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('emitMockLevelUp', () => {
    it('should emit level up notification', async () => {
      const dto: CreateLevelUpNotificationDto = {
        userId: 'test-user',
        newLevel: 5,
        newTitle: 'Gossip Queen',
        xpGained: 100,
      };

      const result = await devController.emitMockLevelUp(dto);

      expect(service.emitLevelUpEvent).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Level up notification emitted successfully' });
    });
  });

  describe('emitMockChallengeCompleted', () => {
    it('should emit challenge completed notification', async () => {
      const dto: CreateChallengeNotificationDto = {
        userId: 'test-user',
        challengeName: 'Perfect Streak',
        streakCount: 5,
        reward: '50 tokens',
      };

      const result = await devController.emitMockChallengeCompleted(dto);

      expect(service.emitChallengeCompletedEvent).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Challenge completed notification emitted successfully' });
    });
  });

  describe('emitMockAchievement', () => {
    it('should emit achievement notification', async () => {
      const dto: CreateAchievementNotificationDto = {
        userId: 'test-user',
        achievementType: 'perfect_guess',
        achievementValue: 10,
        reward: 'Speed boost',
      };

      const result = await devController.emitMockAchievement(dto);

      expect(service.emitAchievementEvent).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Achievement notification emitted successfully' });
    });
  });

  describe('generateMockData', () => {
    it('should generate mock notifications', async () => {
      const result = await devController.generateMockData();

      expect(service.generateMockNotifications).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Mock notifications generated successfully' });
    });
  });

  describe('getMyNotifications', () => {
    it("should return only the caller's notifications", async () => {
      const mockNotifications = [
        { userId: 'user1', message: 'Test 1', timestamp: new Date(), type: 'generic' as const },
      ];

      jest.spyOn(service, 'getNotificationsForUser').mockReturnValue(mockNotifications);

      const result = await controller.getMyNotifications({ id: 'user1' } as any);

      expect(service.getNotificationsForUser).toHaveBeenCalledWith('user1');
      expect(service.getAllNotifications).not.toHaveBeenCalled();
      expect(result).toEqual({ notifications: mockNotifications });
    });
  });

  describe('authorization', () => {
    const guard = new RolesGuard(new Reflector());

    const contextFor = (controllerClass: Function, handler: Function, role: Role): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => controllerClass,
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user1', role } }) }),
      }) as unknown as ExecutionContext;

    const devHandlers = [
      'emitMockLevelUp',
      'emitMockChallengeCompleted',
      'emitMockAchievement',
      'generateMockData',
      'testLevelUp',
      'testChallenge',
      'testAchievement',
    ] as const;

    const adminOnly: Array<[string, Function, Function]> = [
      ['GET user/:userId', NotificationsController, NotificationsController.prototype.getUserNotifications],
      ['DELETE', NotificationsController, NotificationsController.prototype.clearNotifications],
      ...devHandlers.map(
        (name) => [name, NotificationsDevController, NotificationsDevController.prototype[name]] as [string, Function, Function],
      ),
    ];

    it.each(adminOnly)('%s rejects a regular user', (_, cls, handler) => {
      expect(() => guard.canActivate(contextFor(cls, handler, Role.User))).toThrow(ForbiddenException);
    });

    it.each(adminOnly)('%s allows an admin', (_, cls, handler) => {
      expect(guard.canActivate(contextFor(cls, handler, Role.Admin))).toBe(true);
    });

    it('GET me is open to a regular user', () => {
      const context = contextFor(NotificationsController, NotificationsController.prototype.getMyNotifications, Role.User);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('module registration', () => {
    const controllersFor = (nodeEnv: string) => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = nodeEnv;
      try {
        let controllers: Function[] = [];
        jest.isolateModules(() => {
          const { NotificationsModule } = require('./notifications.module');
          controllers = Reflect.getMetadata('controllers', NotificationsModule);
        });
        return controllers.map((c) => c.name);
      } finally {
        process.env.NODE_ENV = previous;
      }
    };

    it('does not register the mock endpoints in production', () => {
      expect(controllersFor('production')).toEqual(['NotificationsController']);
    });

    it('registers the mock endpoints outside production', () => {
      expect(controllersFor('development')).toContain('NotificationsDevController');
    });
  });

  describe('getUserNotifications', () => {
    it('should return notifications for specific user', async () => {
      const userId = 'test-user';
      const mockNotifications = [
        { userId, message: 'Test 1', timestamp: new Date(), type: 'generic' as const },
        { userId, message: 'Test 2', timestamp: new Date(), type: 'generic' as const },
      ];

      jest.spyOn(service, 'getNotificationsForUser').mockReturnValue(mockNotifications);

      const result = await controller.getUserNotifications(userId);

      expect(service.getNotificationsForUser).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ notifications: mockNotifications });
    });
  });

  describe('clearNotifications', () => {
    it('should clear all notifications', async () => {
      const result = await controller.clearNotifications();

      expect(service.clearNotifications).toHaveBeenCalled();
      expect(result).toEqual({ message: 'All notifications cleared' });
    });
  });

  describe('testLevelUp', () => {
    it('should emit test level up notification', async () => {
      const result = await devController.testLevelUp();

      expect(service.emitLevelUpEvent).toHaveBeenCalledWith({
        userId: 'test-user-123',
        newLevel: 10,
        newTitle: 'Lyric Master',
        xpGained: 250,
      });
      expect(result).toEqual({ message: 'Test level up notification emitted' });
    });
  });

  describe('testChallenge', () => {
    it('should emit test challenge notification', async () => {
      const result = await devController.testChallenge();

      expect(service.emitChallengeCompletedEvent).toHaveBeenCalledWith({
        userId: 'test-user-123',
        challengeName: 'Speed Demon',
        streakCount: 10,
        reward: '100 tokens + Speed boost',
      });
      expect(result).toEqual({ message: 'Test challenge notification emitted' });
    });
  });

  describe('testAchievement', () => {
    it('should emit test achievement notification', async () => {
      const result = await devController.testAchievement();

      expect(service.emitAchievementEvent).toHaveBeenCalledWith({
        userId: 'test-user-123',
        achievementType: 'speed_demon',
        achievementValue: 5,
        reward: 'Permanent speed boost',
      });
      expect(result).toEqual({ message: 'Test achievement notification emitted' });
    });
  });
}); 