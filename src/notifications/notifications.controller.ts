import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { 
  CreateLevelUpNotificationDto, 
  CreateChallengeNotificationDto, 
  CreateAchievementNotificationDto 
} from './dto/create-notification.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the caller's notifications" })
  @ApiResponse({ status: 200, description: "Returns the caller's notifications" })
  async getMyNotifications(@GetUser() user: User): Promise<{ notifications: any[] }> {
    const notifications = this.notificationsService.getNotificationsForUser(user.id);
    return { notifications };
  }

  @Roles(Role.Admin)
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get notifications for a specific user' })
  @ApiResponse({ status: 200, description: 'Returns user notifications' })
  async getUserNotifications(@Param('userId') userId: string): Promise<{ notifications: any[] }> {
    const notifications = this.notificationsService.getNotificationsForUser(userId);
    return { notifications };
  }

  @Roles(Role.Admin)
  @Delete()
  @ApiOperation({ summary: 'Clear all stored notifications' })
  @ApiResponse({ status: 200, description: 'All notifications cleared' })
  async clearNotifications(): Promise<{ message: string }> {
    this.notificationsService.clearNotifications();
    return { message: 'All notifications cleared' };
  }
}

/**
 * Endpoints that emit arbitrary notifications to any user ID. Admin only, and
 * only registered outside production (see NotificationsModule).
 */
@ApiTags('notifications')
@Roles(Role.Admin)
@Controller('notifications')
export class NotificationsDevController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('mock-level-up')
  @ApiOperation({ summary: 'Emit a mock level up notification' })
  @ApiBody({ type: CreateLevelUpNotificationDto })
  @ApiResponse({ status: 201, description: 'Level up notification emitted successfully' })
  @HttpCode(HttpStatus.CREATED)
  async emitMockLevelUp(@Body() dto: CreateLevelUpNotificationDto): Promise<{ message: string }> {
    this.notificationsService.emitLevelUpEvent(dto);
    return { message: 'Level up notification emitted successfully' };
  }

  @Post('mock-challenge-completed')
  @ApiOperation({ summary: 'Emit a mock challenge completed notification' })
  @ApiBody({ type: CreateChallengeNotificationDto })
  @ApiResponse({ status: 201, description: 'Challenge completed notification emitted successfully' })
  @HttpCode(HttpStatus.CREATED)
  async emitMockChallengeCompleted(@Body() dto: CreateChallengeNotificationDto): Promise<{ message: string }> {
    this.notificationsService.emitChallengeCompletedEvent(dto);
    return { message: 'Challenge completed notification emitted successfully' };
  }

  @Post('mock-achievement')
  @ApiOperation({ summary: 'Emit a mock achievement notification' })
  @ApiBody({ type: CreateAchievementNotificationDto })
  @ApiResponse({ status: 201, description: 'Achievement notification emitted successfully' })
  @HttpCode(HttpStatus.CREATED)
  async emitMockAchievement(@Body() dto: CreateAchievementNotificationDto): Promise<{ message: string }> {
    this.notificationsService.emitAchievementEvent(dto);
    return { message: 'Achievement notification emitted successfully' };
  }

  @Post('generate-mock-data')
  @ApiOperation({ summary: 'Generate sample mock notifications for testing' })
  @ApiResponse({ status: 201, description: 'Mock notifications generated successfully' })
  @HttpCode(HttpStatus.CREATED)
  async generateMockData(): Promise<{ message: string }> {
    this.notificationsService.generateMockNotifications();
    return { message: 'Mock notifications generated successfully' };
  }

  // Quick test endpoints with predefined data
  @Post('test/level-up')
  @ApiOperation({ summary: 'Quick test level up notification' })
  @ApiResponse({ status: 201, description: 'Test level up notification emitted' })
  @HttpCode(HttpStatus.CREATED)
  async testLevelUp(): Promise<{ message: string }> {
    this.notificationsService.emitLevelUpEvent({
      userId: 'test-user-123',
      newLevel: 10,
      newTitle: 'Lyric Master',
      xpGained: 250,
    });
    return { message: 'Test level up notification emitted' };
  }

  @Post('test/challenge')
  @ApiOperation({ summary: 'Quick test challenge notification' })
  @ApiResponse({ status: 201, description: 'Test challenge notification emitted' })
  @HttpCode(HttpStatus.CREATED)
  async testChallenge(): Promise<{ message: string }> {
    this.notificationsService.emitChallengeCompletedEvent({
      userId: 'test-user-123',
      challengeName: 'Speed Demon',
      streakCount: 10,
      reward: '100 tokens + Speed boost',
    });
    return { message: 'Test challenge notification emitted' };
  }

  @Post('test/achievement')
  @ApiOperation({ summary: 'Quick test achievement notification' })
  @ApiResponse({ status: 201, description: 'Test achievement notification emitted' })
  @HttpCode(HttpStatus.CREATED)
  async testAchievement(): Promise<{ message: string }> {
    this.notificationsService.emitAchievementEvent({
      userId: 'test-user-123',
      achievementType: 'speed_demon',
      achievementValue: 5,
      reward: 'Permanent speed boost',
    });
    return { message: 'Test achievement notification emitted' };
  }
} 