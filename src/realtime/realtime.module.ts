import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import { EntityEventsSubscriber } from './entity-events.subscriber';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameSession, RoomUser]),
    JwtModule.register({}),
  ],
  providers: [RealtimeGateway, EntityEventsSubscriber],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
