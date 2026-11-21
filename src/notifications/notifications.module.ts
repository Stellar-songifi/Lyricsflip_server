import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

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
export class NotificationsModule {}
