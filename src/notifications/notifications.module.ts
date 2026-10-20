import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsController, NotificationsDevController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers:
    new ConfigService().get<string>('NODE_ENV') === 'production'
      ? [NotificationsController]
      : [NotificationsController, NotificationsDevController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {} 