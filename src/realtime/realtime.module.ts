import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import { EntityEventsSubscriber } from './entity-events.subscriber';
import { RealtimeGateway } from './realtime.gateway';
import { SocketAuthenticator } from '../auth/socket-authenticator';
import { SubscriptionRevoker } from './subscription-revoker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameSession, RoomUser]),
    JwtModule.register({}),
  ],
  providers: [RealtimeGateway, EntityEventsSubscriber, SocketAuthenticator],
  exports: [RealtimeGateway],
  providers: [RealtimeGateway, EntityEventsSubscriber, SubscriptionRevoker],
  exports: [RealtimeGateway, SubscriptionRevoker],
})
export class RealtimeModule {}
