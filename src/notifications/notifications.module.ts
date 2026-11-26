import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), RealtimeModule],
  // Mock and test endpoints do not exist in production builds.
  controllers:
    process.env.NODE_ENV === 'production'
      ? [NotificationsController]
      : [NotificationsController, NotificationsDevController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
