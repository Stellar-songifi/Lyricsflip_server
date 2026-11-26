import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
class NotificationsCoreModule {}

@Module({
  imports: [NotificationsCoreModule],
  controllers: [NotificationsDevController],
})
class NotificationsDevModule {}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    NotificationsCoreModule,
    ConditionalModule.registerWhen(
      NotificationsDevModule,
      (env) => env.NODE_ENV !== 'production',
    ),
  ],
  controllers: [NotificationsController],
  exports: [NotificationsCoreModule],
})
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
