import {
  DomainException,
  ErrorCode,
} from '../common/exceptions/domain.exception';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { allowsWebSocketOrigin } from '../common/security/cors';
import { Repository } from 'typeorm';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import { Room } from '../rooms/entities/room.entity';
import { User } from '../users/entities/user.entity';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import {
  SocketAuthenticator,
  USER_SESSIONS_REVOKED_EVENT,
  UserSessionsRevokedPayload,
} from '../auth/socket-authenticator';
import { WsRateLimiter } from '../common/websocket/ws-rate-limiter';
import { WsConnectionLimiter } from '../common/websocket/ws-connection-limiter';
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
  | { ok: false; error: string; code: ErrorCode };

export type SpectateAck =
  | { ok: true; room: string; spectators: number }
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
 *
 * Spectators join a separate `spectate:<type>:<id>` room so they receive
 * scoreboard and round events but never gameplay-only payloads (answers).
 */
@UseFilters(WsExceptionFilter)
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    // Same allow-list as the HTTP API (FRONTEND_URL), evaluated per request.
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, allowsWebSocketOrigin(origin));
    },
    credentials: true,
  },
  maxHttpBufferSize: WS_MAX_HTTP_BUFFER_SIZE,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly rateLimiter: WsRateLimiter;
  private readonly connectionLimiter: WsConnectionLimiter;

  constructor(
    private readonly socketAuthenticator: SocketAuthenticator,
    private readonly configService: ConfigService,
    @InjectRepository(GameSession)
    private readonly sessionRepository: Repository<GameSession>,
    @InjectRepository(RoomUser)
    private readonly roomUserRepository: Repository<RoomUser>,
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.rateLimiter = new WsRateLimiter(this.configService);
    this.connectionLimiter = new WsConnectionLimiter(this.configService);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.socketAuthenticator.authenticateSocket(client);
      client.data.userId = user.id;
      // Read by @GetUser, RolesGuard and JwtAuthGuard in handlers (#362).
      client.data.user = user;
    } catch (error) {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.emit('error', {
        code:
          error instanceof DomainException
            ? error.code
            : ErrorCode.UNAUTHORIZED,
        message: 'Unauthorized',
      });
      client.disconnect(true);
      return;
    }

    if (
      !(await this.connectionLimiter.acquire(client.data.userId, client.id))
    ) {
      client.emit('error', {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many concurrent connections',
      });
      client.disconnect(true);
      return;
    }

    await client.join(realtimeRooms.user(client.data.userId));
    client.emit('connected', { userId: client.data.userId });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Realtime client disconnected: ${client.id}`);
    this.rateLimiter.clear(client.id);
    void this.connectionLimiter.release(client.data?.userId, client.id);
  }

  /**
   * Drops every open socket of a user whose tokens were revoked (password
   * change, logout-all, deactivation). With the Redis adapter `fetchSockets`
   * reaches sockets on every instance, not just this one.
   */
  @OnEvent(USER_SESSIONS_REVOKED_EVENT)
  async onUserSessionsRevoked(
    payload: UserSessionsRevokedPayload,
  ): Promise<void> {
    if (!this.server || !payload?.userId) return;
    const room = realtimeRooms.user(payload.userId);
    try {
      const sockets = await this.server.in(room).fetchSockets();
      for (const socket of sockets) {
        socket.emit('error', {
          code: ErrorCode.TOKEN_REVOKED,
          message: 'Session revoked',
        });
      }
      this.server.in(room).disconnectSockets(true);
      if (sockets.length > 0) {
        this.logger.log(
          `Disconnected ${sockets.length} socket(s) for revoked user ${payload.userId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to disconnect sockets for user ${payload.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Joins a session or room channel, if the caller is a member of it. */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() body: SubscribeRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<SubscribeAck> {
    if (!this.rateLimiter.consume(client, 'subscribe')) {
      client.emit('error', {
        code: ErrorCode.RATE_LIMITED,
        message: 'Rate limited',
      });
      return { ok: false, error: 'RATE_LIMITED', code: ErrorCode.RATE_LIMITED };
    }

    const userId: string | undefined = client.data?.userId;

    if (
      !userId ||
      !body ||
      !['session', 'room'].includes(body.type) ||
      !isUUID(body.id)
    ) {
      return {
        ok: false,
        error: 'Invalid subscription',
        code: ErrorCode.VALIDATION_ERROR,
      };
    }

    const allowed =
      body.type === 'session'
        ? await this.isSessionPlayer(userId, body.id)
        : await this.isRoomMember(userId, body.id);

    // Not a member and does not exist look the same, so ids cannot be probed.
    if (!allowed) {
      return { ok: false, error: 'Not found', code: ErrorCode.NOT_FOUND };
    }

    const room =
      body.type === 'session'
        ? realtimeRooms.session(body.id)
        : realtimeRooms.room(body.id);

    await client.join(room);
    return { ok: true, room };
  }

  /**
   * Joins the spectator channel of a public room or of a head-to-head match
   * whose players have opted in to spectators. Spectators only receive
   * scoreboard and round events, never gameplay payloads.
   */
  @SubscribeMessage('spectate')
  async handleSpectate(
    @MessageBody() body: SubscribeRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<SpectateAck> {
    if (!this.rateLimiter.consume(client, 'spectate')) {
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: 'Rate limited',
      });
      return { ok: false, error: 'RATE_LIMITED' };
    }

    const userId: string | undefined = client.data?.userId;

    if (
      !userId ||
      !body ||
      !['session', 'room'].includes(body.type) ||
      !isUUID(body.id)
    ) {
      return { ok: false, error: 'Invalid spectate request' };
    }

    const allowed =
      body.type === 'session'
        ? await this.canSpectateSession(userId, body.id)
        : await this.canSpectateRoom(userId, body.id);

    // Not allowed and does not exist look the same, so ids cannot be probed.
    if (!allowed) {
      return { ok: false, error: 'Not found' };
    }

    const room = realtimeRooms.spectate(body.type, body.id);
    await client.join(room);

    const spectators = await this.countSpectators(room);
    this.broadcastSpectatorCount(body.type, body.id, spectators);

    return { ok: true, room, spectators };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() body: SubscribeRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<SubscribeAck> {
    if (!this.rateLimiter.consume(client, 'unsubscribe')) {
      client.emit('error', {
        code: ErrorCode.RATE_LIMITED,
        message: 'Rate limited',
      });
      return { ok: false, error: 'RATE_LIMITED', code: ErrorCode.RATE_LIMITED };
    }

    if (!body || !['session', 'room'].includes(body.type) || !isUUID(body.id)) {
      return {
        ok: false,
        error: 'Invalid subscription',
        code: ErrorCode.VALIDATION_ERROR,
      };
    }

    const room =
      body.type === 'session'
        ? realtimeRooms.session(body.id)
        : realtimeRooms.room(body.id);

    await client.leave(room);

    // Leaving a spectator channel updates the count shown to the players.
    const spectateRoom = realtimeRooms.spectate(body.type, body.id);
    if (client.rooms.has(spectateRoom)) {
      await client.leave(spectateRoom);
      const spectators = await this.countSpectators(spectateRoom);
      this.broadcastSpectatorCount(body.type, body.id, spectators);
    }

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

  /** Public rooms are open to spectators; private rooms are not. */
  private async canSpectateRoom(
    userId: string,
    roomId: string,
  ): Promise<boolean> {
    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) return false;
    if (room.isPrivate) return false;
    // Members already receive the full channel; spectating is for outsiders.
    return !(await this.isRoomMember(userId, roomId));
  }

  /**
   * A head-to-head match is spectatable only when both players have enabled
   * the `allowSpectators` preference.
   */
  private async canSpectateSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: { player: true },
    });
    if (!session) return false;

    const playerIds = [session.player?.id, session.playerTwoId].filter(
      (id): id is string => !!id,
    );
    if (playerIds.length === 0) return false;
    // Players already receive the full channel; spectating is for outsiders.
    if (playerIds.includes(userId)) return false;

    const players = await this.userRepository.find({
      where: playerIds.map((id) => ({ id })),
    });
    if (players.length !== playerIds.length) return false;

    return players.every((player) => player.allowSpectators === true);
  }

  private async countSpectators(room: string): Promise<number> {
    if (!this.server) return 0;
    try {
      const sockets = await this.server.in(room).fetchSockets();
      return sockets.length;
    } catch {
      return 0;
    }
  }

  /** Tells the players of a room/match how many people are watching. */
  private broadcastSpectatorCount(
    type: 'session' | 'room',
    id: string,
    spectators: number,
  ): void {
    if (!this.server) return;
    const target =
      type === 'session'
        ? realtimeRooms.session(id)
        : realtimeRooms.room(id);
    this.server.to(target).emit('spectator_count', { type, id, spectators });
  /**
   * Removes every socket of `userId` from `channel` across all instances.
   * Used when a subscription is no longer valid (room leave, session end,
   * account deactivation) so stale channels stop delivering events.
   */
  private async revokeChannel(
    userId: string,
    channel: string,
  ): Promise<void> {
    if (!this.server || !userId || !channel) return;
    try {
      this.server.in(realtimeRooms.user(userId)).socketsLeave(channel);
    } catch (error) {
      this.logger.error(
        `Failed to revoke ${channel} for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Revokes a user's sockets from a room channel (e.g. on room leave). */
  async revokeRoomSubscription(userId: string, roomId: string): Promise<void> {
    await this.revokeChannel(userId, realtimeRooms.room(roomId));
  }

  /** Revokes a user's sockets from a session channel (e.g. on session end). */
  async revokeSessionSubscription(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    await this.revokeChannel(userId, realtimeRooms.session(sessionId));
  }

  /**
   * Rechecks membership for a sensitive channel before delivery. Sockets that
   * are no longer members are removed from the channel so they stop receiving
   * its events.
   */
  private async pruneStaleSubscribers(
    channel: string,
    type: 'session' | 'room',
    id: string,
  ): Promise<void> {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(channel).fetchSockets();
      for (const socket of sockets) {
        const userId: string | undefined = socket.data?.userId;
        if (!userId) continue;
        const allowed =
          type === 'session'
            ? await this.isSessionPlayer(userId, id)
            : await this.isRoomMember(userId, id);
        if (!allowed) {
          socket.leave(channel);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to prune ${channel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
      .emit(event, { ...payload });
  }

  @OnEvent(RealtimeEvent.MATCH_FOUND)
  onMatchFound(payload: { sessionId: string; players: string[] }): void {
    this.deliver(payload.players.map(realtimeRooms.user), RealtimeEvent.MATCH_FOUND, {
      sessionId: payload.sessionId,
    });
  }

  @OnEvent(RealtimeEvent.TOURNAMENT_BRACKET_UPDATED)
  onTournamentBracketUpdated(payload: { tournamentId: string; players: string[] }): void {
    this.deliver(payload.players.map(realtimeRooms.user), RealtimeEvent.TOURNAMENT_BRACKET_UPDATED, {
      tournamentId: payload.tournamentId,
    });
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
  /**
   * Delivers a scoreboard/round event to players and, when the channel is
   * spectatable, to its spectators too. Never used for answer payloads.
   */
  private deliverWithSpectators(
    type: 'session' | 'room',
    id: string,
    event: RealtimeEvent,
    payload: object,
  ): void {
    if (!this.server) return;
    const playerRoom =
      type === 'session'
        ? realtimeRooms.session(id)
        : realtimeRooms.room(id);
    this.server
      .to([playerRoom, realtimeRooms.spectate(type, id)])
      .emit(event, { ...payload });
  }

  @OnEvent('round.started')
  onRoundStarted(payload: RoundStartedPayload): void {
    this.deliverWithSpectators(
      'session',
      payload.sessionId,
      'round_started',
      .emit(event, payload);
  }

  @OnEvent('player.joined')
  handlePlayerJoined(payload: PlayerJoinedPayload): void {
    this.deliver([realtimeRooms.room(payload.roomId)], 'player.joined', payload);
  }

  @OnEvent('round.started')
  handleRoundStarted(payload: RoundStartedPayload): void {
    this.deliver(
      [realtimeRooms.session(payload.sessionId)],
      'round.started',
      payload,
    );
  }

  @OnEvent('round.ended')
  handleRoundEnded(payload: RoundEndedPayload): void {
    this.deliver(
      [realtimeRooms.session(payload.sessionId)],
      'round.ended',
      payload,
    );
  }

  @OnEvent('round.ended')
  onRoundEnded(payload: RoundEndedPayload): void {
    this.deliverWithSpectators(
      'session',
      payload.sessionId,
      'round_ended',
      payload,
    );
  }

  @OnEvent('session.completed')
  onSessionCompleted(payload: SessionCompletedPayload): void {
    this.deliverWithSpectators(
      'session',
      payload.sessionId,
      'session_completed',
      payload,
    );
  }

  @OnEvent('player.joined')
  onPlayerJoined(payload: PlayerJoinedPayload): void {
    this.deliverWithSpectators(
      'room',
      payload.roomId,
      'player_joined',
  @OnEvent('wager.staked')
  handleWagerStaked(payload: WagerStakedPayload): void {
    this.deliver(
      [realtimeRooms.session(payload.sessionId)],
      'wager.staked',
      payload,
    );
  }

  @OnEvent('wager.staked')
  onWagerStaked(payload: WagerStakedPayload): void {
    this.deliverWithSpectators(
      'session',
      payload.sessionId,
      'wager_staked',
      payload,
    );
  }

  @OnEvent('wager.settled')
  onWagerSettled(payload: WagerSettledPayload): void {
    this.deliverWithSpectators(
      'session',
      payload.sessionId,
      'wager_settled',
      payload,
    );
  }
  @OnEvent('wager.settled')
  handleWagerSettled(payload: WagerSettledPayload): void {
    this.deliver(
      [realtimeRooms.session(payload.sessionId)],
      'wager.settled',
      payload,
    );
  }

  @OnEvent('session.completed')
  async handleSessionCompleted(
    payload: SessionCompletedPayload,
  ): Promise<void> {
    const channel = realtimeRooms.session(payload.sessionId);
    this.deliver([channel], 'session.completed', payload);
    // Session is over: drop every socket from the channel across instances.
    if (!this.server) return;
    try {
      this.server.in(channel).socketsLeave(channel);
    } catch (error) {
      this.logger.error(
        `Failed to clear ${channel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
