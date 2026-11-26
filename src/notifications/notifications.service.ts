import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { 
  NotificationPayload, 
  LevelUpNotificationPayload, 
  ChallengeCompletedNotificationPayload,
  GameAchievementNotificationPayload 
} from './interfaces/notification.interface';
import { 
  CreateLevelUpNotificationDto, 
  CreateChallengeNotificationDto, 
  CreateAchievementNotificationDto 
} from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { RealtimeRoomsService } from '../realtime/realtime-rooms.service';
import { PushService } from '../push/push.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';

const RETENTION_DAYS = 90;

export interface NotificationQueryOptions {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}

export interface PaginatedNotifications {
  notifications: Notification[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private eventEmitter: EventEmitter2,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly realtimeRooms: RealtimeRoomsService,
    @Optional() private readonly pushService?: PushService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  // Event emission methods
  emitLevelUpEvent(dto: CreateLevelUpNotificationDto): void {
    const payload: LevelUpNotificationPayload = {
      userId: dto.userId,
      timestamp: new Date(),
      message: `🎉 You leveled up to ${dto.newTitle}!`,
      newLevel: dto.newLevel,
      newTitle: dto.newTitle,
      xpGained: dto.xpGained,
    };

    this.logger.log(`Emitting level up event for user ${dto.userId}`);
    this.eventEmitter.emit('user.leveled_up', payload);
  }

  emitChallengeCompletedEvent(dto: CreateChallengeNotificationDto): void {
    const payload: ChallengeCompletedNotificationPayload = {
      userId: dto.userId,
      timestamp: new Date(),
      message: `🔥 You completed ${dto.challengeName} with ${dto.streakCount} correct guesses in a row!`,
      challengeName: dto.challengeName,
      streakCount: dto.streakCount,
      reward: dto.reward,
    };

    this.logger.log(`Emitting challenge completed event for user ${dto.userId}`);
    this.eventEmitter.emit('user.completed_challenge', payload);
  }

  emitAchievementEvent(dto: CreateAchievementNotificationDto): void {
    const achievementMessages = {
      perfect_guess: '🎯 Perfect guess!',
      streak: '🔥 Streak achieved!',
      first_win: '🏆 First win!',
      speed_demon: '⚡ Speed demon!',
    };

    const payload: GameAchievementNotificationPayload = {
      userId: dto.userId,
      timestamp: new Date(),
      message: `${achievementMessages[dto.achievementType]} ${dto.achievementValue ? `(${dto.achievementValue})` : ''}`,
      achievementType: dto.achievementType,
      achievementValue: dto.achievementValue,
      reward: dto.reward,
    };

    this.logger.log(`Emitting achievement event for user ${dto.userId}`);
    this.eventEmitter.emit('user.achievement_unlocked', payload);
  }

  // Event listeners
  @OnEvent('user.leveled_up')
  async handleLevelUpEvent(payload: LevelUpNotificationPayload): Promise<void> {
    this.logger.log(`🎉 Level up notification: ${payload.message}`);
    await this.storeNotification('level_up', payload);
  }

  @OnEvent('user.completed_challenge')
  async handleChallengeCompletedEvent(payload: ChallengeCompletedNotificationPayload): Promise<void> {
    this.logger.log(`🔥 Challenge completed notification: ${payload.message}`);
    await this.storeNotification('challenge_completed', payload);
  }

  @OnEvent('user.achievement_unlocked')
  async handleAchievementEvent(payload: GameAchievementNotificationPayload): Promise<void> {
    this.logger.log(`🏆 Achievement notification: ${payload.message}`);
    await this.storeNotification('achievement_unlocked', payload);
  }

  // Storage methods
  private async storeNotification(type: string, notification: NotificationPayload): Promise<Notification> {
    const entity = this.notificationRepository.create({
      userId: notification.userId,
      type,
      payload: notification as unknown as Record<string, unknown>,
      readAt: null,
    });

    const saved = await this.notificationRepository.save(entity);
    this.logger.log(`Stored notification ${saved.id}: ${notification.message}`);

    this.realtimePublisher.toUser(notification.userId, 'notification', saved);

    // Deliver a push notification when the app is closed. PushService enforces
    // per-type preferences and quiet hours, and prunes dead subscriptions.
    if (this.pushService) {
      try {
        await this.pushService.sendToUser(notification.userId, type, {
          title: this.pushTitleFor(type),
          body: notification.message,
          data: { type, notificationId: saved.id },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to send push for notification ${saved.id}: ${(error as Error).message}`,
        );
      }
    }

    return saved;
  }

  private pushTitleFor(type: string): string {
    switch (type) {
      case 'level_up':
        return 'Level up!';
      case 'challenge_completed':
        return 'Challenge completed';
      case 'achievement_unlocked':
        return 'Achievement unlocked';
      case 'invitation':
        return 'Match invitation';
      case 'match_found':
        return 'Match found';
      case 'your_turn':
        return 'Your turn';
      case 'wager_settled':
        return 'Wager settled';
      case 'wager_refunded':
        return 'Wager refunded';
      default:
        return 'New notification';
    }
  }

  // Retrieval methods
  async getNotificationsForUser(
    userId: string,
    options: NotificationQueryOptions = {},
  ): Promise<PaginatedNotifications> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));

    const where: Record<string, unknown> = { userId };
    if (options.unreadOnly) {
      where.readAt = null;
    }

    const [notifications, total] = await this.notificationRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { notifications, total, page, limit };
  }

  async markAsRead(userId: string, id: string): Promise<Notification | null> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      return null;
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepository.save(notification);
    }

    return notification;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationRepository.update(
      { userId, readAt: null },
      { readAt: new Date() },
    );

    return result.affected ?? 0;
  }

  // Per-user deletion (scoped to the requesting user)
  async clearNotifications(userId: string): Promise<number> {
    const result = await this.notificationRepository.delete({ userId });

    this.logger.log(`Cleared ${result.affected ?? 0} notifications for user ${userId}`);

    return result.affected ?? 0;
  }

  // Retention job: delete read notifications older than the retention window
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const result = await this.notificationRepository.delete({
      readAt: LessThan(cutoff),
    });

    this.logger.log(
      `Purged ${result.affected ?? 0} read notifications older than ${RETENTION_DAYS} days`,
    );
  }

  // Mock data generation (non-production only; writes through the same path)
  generateMockNotifications(): void {
    const mockUserId = 'mock-user-123';
    
    // Generate level up notification
    this.emitLevelUpEvent({
      userId: mockUserId,
      newLevel: 5,
      newTitle: 'Rising Star',
      xpGained: 100,
    });

    // Generate challenge notification
    this.emitChallengeCompletedEvent({
      userId: mockUserId,
      challengeName: 'Perfect Streak',
      streakCount: 5,
      reward: '50 tokens',
    });

    // Generate achievement notification
    this.emitAchievementEvent({
      userId: mockUserId,
      achievementType: 'perfect_guess',
      achievementValue: 10,
      reward: 'Speed boost',
    });
  }
}
