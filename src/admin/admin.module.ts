import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { UsersModule } from '../users/users.module';
import { LyricsModule } from '../lyrics/lyrics.module';

@Module({
  imports: [UsersModule, LyricsModule],
  controllers: [AdminController, AdminAnalyticsController],
  providers: [AdminService, AdminAnalyticsService],
})
export class AdminModule {}
