import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import {
  PlayerJoinedPayload,
  RealtimeEvent,
  RoundEndedPayload,
  RoundStartedPayload,
  SessionCompletedPayload,
  WagerSettledPayload,
  WagerStakedPayload,
  realtimeRooms,
} from './realtime.events';

export interface SubscribeRequest {
  type: 'session' | 'room';
  id: string;
}

export type SubscribeAck =
  | { ok: true; room: string }
  | { ok: false; error: string };

/**
 * Pushes game events to connected players in real time.
 *
 * Each socket authenticates with the same JWT as the HTTP API, is put in a
 * private `user:<id>` room, and may `subscribe` to the `session:<id>` and
 * `room:<id>` rooms it belongs to. Services raise events on the EventEmitter2
 * bus; the handlers below fan them out to the right rooms. With the Redis
 * adapter enabled (see RedisIoAdapter) an event raised on one instance reaches
 * sockets connected to any other.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    // Same allow-list as the HTTP API (FRONTEND_URL), evaluated per request.
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowed = process.env.FRONTEND_URL || 'http://localhost:3000';
      callback(null, !origin || origin === allowed);
    },
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(GameSession)
    private readonly sessionRepository: Repository<GameSession>,
    @InjectRepository(RoomUser)
    private readonly roomUserRepository: Repository<RoomUser>,
  ) {}

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) {
      return authToken.replace(/^Bearer\s+/i, '');
    }
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
      return header.replace(/^Bearer\s+/i, '');
    }
    return undefined;
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        { secret: this.configService.get<string>('JWT_SECRET') },
      );
      client.data.userId = payload.sub;
    } catch {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    await client.join(realtimeRooms.user(client.data.userId));
    client.emit('connected', { userId: client.data.userId });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Realtime client disconnected: ${client.id}`);
  }

  /** Joins a session or room channel, if the caller is a member of it. */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() body: SubscribeRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<SubscribeAck> {
    const userId: string | undefined = client.data?.userId;

    if (
      !userId ||
      !body ||
      !['session', 'room'].includes(body.type) ||
      !isUUID(body.id)
    ) {
      return { ok: false, error: 'Invalid subscription' };
    }

    const allowed =
      body.type === 'session'
        ? await this.isSessionPlayer(userId, body.id)
        : await this.isRoomMember(userId, body.id);

    // Not a member and does not exist look the same, so ids cannot be probed.
    if (!allowed) {
      return { ok: false, error: 'Not found' };
    }

    const room =
      body.type === 'session'
        ? realtimeRooms.session(body.id)
        : realtimeRooms.room(body.id);

    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() body: SubscribeRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<SubscribeAck> {
    if (!body || !['session', 'room'].includes(body.type) || !isUUID(body.id)) {
      return { ok: false, error: 'Invalid subscription' };
    }

    const room =
      body.type === 'session'
        ? realtimeRooms.session(body.id)
        : realtimeRooms.room(body.id);

    await client.leave(room);
    return { ok: true, room };
  }

  private async isSessionPlayer(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: { player: true },
    });

    return (
      !!session &&
      (session.player?.id === userId || session.playerTwoId === userId)
    );
  }

  private async isRoomMember(userId: string, roomId: string): Promise<boolean> {
    return !!(await this.roomUserRepository.findOne({
      where: { roomId, userId },
    }));
  }

  /** Delivers `event` to every room in `rooms`, once per socket. */
  private deliver(
    rooms: string[],
    event: RealtimeEvent,
    payload: object,
  ): void {
    if (!this.server || rooms.length === 0) return;
    this.server
      .to(rooms)
      .emit(event, { ...payload, at: new Date().toISOString() });
  }

  @OnEvent(RealtimeEvent.PLAYER_JOINED)
  onPlayerJoined(payload: PlayerJoinedPayload): void {
    const rooms =
      payload.scope === 'room' && payload.roomId
        ? [realtimeRooms.room(payload.roomId)]
        : payload.sessionId
          ? [realtimeRooms.session(payload.sessionId)]
          : [];
    // The joining player may not have subscribed yet.
    this.deliver(
      [...rooms, realtimeRooms.user(payload.userId)],
      RealtimeEvent.PLAYER_JOINED,
      payload,
    );
  }

  @OnEvent(RealtimeEvent.ROUND_STARTED)
  onRoundStarted(payload: RoundStartedPayload): void {
    this.deliver(
      this.roundRooms(payload),
      RealtimeEvent.ROUND_STARTED,
      payload,
    );
  }

  @OnEvent(RealtimeEvent.ROUND_ENDED)
  onRoundEnded(payload: RoundEndedPayload): void {
    this.deliver(this.roundRooms(payload), RealtimeEvent.ROUND_ENDED, payload);
  }

  @OnEvent(RealtimeEvent.SESSION_COMPLETED)
  onSessionCompleted(payload: SessionCompletedPayload): void {
    const players = [payload.playerId, payload.playerTwoId].filter(
      (id): id is string => !!id,
    );
    this.deliver(
      [
        realtimeRooms.session(payload.sessionId),
        ...players.map(realtimeRooms.user),
      ],
      RealtimeEvent.SESSION_COMPLETED,
      payload,
    );
  }

  @OnEvent(RealtimeEvent.WAGER_STAKED)
  onWagerStaked(payload: WagerStakedPayload): void {
    this.deliver(this.wagerRooms(payload), RealtimeEvent.WAGER_STAKED, payload);
  }

  @OnEvent(RealtimeEvent.WAGER_SETTLED)
  onWagerSettled(payload: WagerSettledPayload): void {
    this.deliver(
      this.wagerRooms(payload),
      RealtimeEvent.WAGER_SETTLED,
      payload,
    );
  }

  private roundRooms(payload: {
    sessionId: string | null;
    userId: string;
  }): string[] {
    return [
      realtimeRooms.user(payload.userId),
      ...(payload.sessionId ? [realtimeRooms.session(payload.sessionId)] : []),
    ];
  }

  private wagerRooms(payload: {
    sessionId: string;
    playerAId: string;
    playerBId: string;
  }): string[] {
    return [
      realtimeRooms.session(payload.sessionId),
      realtimeRooms.user(payload.playerAId),
      realtimeRooms.user(payload.playerBId),
    ];
  }
}
