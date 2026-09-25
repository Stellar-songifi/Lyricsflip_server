import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  // Mock and test endpoints do not exist in production builds.
  controllers:
    process.env.NODE_ENV === 'production'
      ? [NotificationsController]
      : [NotificationsController, NotificationsDevController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {} 