import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import {
  DomainException,
  ErrorCode,
} from '../common/exceptions/domain.exception';
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Logger,
  NotFoundException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
  HttpStatus,
  Logger,
  NotFoundException,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Logger, NotFoundException, UsePipes } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GameLogicService } from './game.service';
import { RandomLyricOptionsDto } from './dto/random-lyrics-option.dto';
import { GuessDto } from './dto/guess.dto';
import { SocketUser } from '../auth/auth-context.util';
import { authenticateSocket } from '../auth/socket-auth.util';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { allowsWebSocketOrigin } from '../common/security/cors';
import { RealtimeEvent } from '../realtime/realtime.events';
import { WsRateLimiter } from '../common/websocket/ws-rate-limiter';
import { WsConnectionLimiter } from '../common/websocket/ws-connection-limiter';
import {
  WsConnectionLimiter,
  WS_MAX_HTTP_BUFFER_SIZE,
} from '../common/websocket/ws-connection-limiter';
import { registerSocketAuth } from '../realtime/socket-auth';
import {
  socketCorsOptions,
  socketValidationPipe,
} from '../realtime/socket-config';

interface GameSession {
  playerId: string;
  /** Round currently open for this socket, if any. */
  currentRoundId?: string;
  /** Lyric IDs already served to this socket, to avoid repeats. */
  seenLyricIds: Set<number>;
}

@UseFilters(WsExceptionFilter)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new DomainException(
        ErrorCode.VALIDATION_ERROR,
        HttpStatus.BAD_REQUEST,
        'Validation failed',
        errors.map((error) => ({
          field: error.property,
          messages: Object.values(error.constraints ?? {}),
        })),
      ),
  }),
)
@UsePipes(socketValidationPipe)
@WebSocketGateway({
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
  cors: socketCorsOptions,
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  // Socket-local state keyed by client.id so two tabs of the same user play
  // independently. Authoritative round/score state lives in the database.
  private sessions = new Map<string, GameSession>();
  private readonly rateLimiter = new WsRateLimiter();
  private readonly connectionLimiter = new WsConnectionLimiter();

  constructor(
    private readonly gameLogicService: GameLogicService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns false (and rejects the event with a RATE_LIMITED error) if the
   * event exceeds its per-socket rate limit. Over-limit events are never
   * processed by the handler.
   */
  private allow(client: Socket, event: string): boolean {
    const result = this.rateLimiter.consume(client, event);
    if (!result.allowed) {
      client.emit('error', {
        code: ErrorCode.RATE_LIMITED,
        message: `Rate limit exceeded for ${event}`,
        event,
        retryAfterMs: result.retryAfterMs,
      });
      this.logger.warn(
        `Rate limited ${client.id} on ${event} (retry in ${result.retryAfterMs}ms)`,
      );
      return false;
    }
    return true;
  }

  async handleConnection(client: Socket) {
    let userId: string;
    let user: SocketUser;
    try {
      user = await authenticateSocket(
        client,
        this.jwtService,
        this.configService,
      );
      userId = user.id;
    } catch {
      const authenticated = await authenticateSocket(client);
      userId = authenticated.userId;
      user = authenticated.user;
    } catch (error) {
    // Authentication is handled by the shared io.use middleware, which sets
    // client.data.user/userId or rejects the handshake before we get here.
    registerSocketAuth(this.server);
    const userId: string | undefined = client.data?.userId;
    if (!userId) {
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

    if (!(await this.connectionLimiter.acquire(userId, client.id))) {
      client.emit('error', {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many concurrent connections',
      });
      client.disconnect(true);
      return;
    }

    // Join a per-user room so revocation can target every socket of the user.
    await client.join(`user:${userId}`);
    this.logger.log(`Client connected: ${client.id} (user ${userId})`);

    // Initialize per-socket session, keyed by client.id.
    this.sessions.set(client.id, {
      playerId: userId,
      seenLyricIds: new Set<number>(),
    });

    client.emit('connected', {
      message: 'Connected to LyricFlip game!',
      sessionId: client.id,
    });
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.sessions.delete(client.id);
    this.rateLimiter.clear(client.id);
    await this.connectionLimiter.release(client.data?.userId, client.id);
  }

  /**
   * Disconnects every socket of a user whose token was revoked (password
   * change, logout-all, deactivation) across all instances via the Redis
   * adapter.
   */
  @OnEvent(RealtimeEvent.USER_SESSIONS_REVOKED)
  async handleUserSessionsRevoked(payload: { userId: string }) {
    if (!payload?.userId) return;
    try {
      const sockets = await this.server
        .in(`user:${payload.userId}`)
        .fetchSockets();
      for (const socket of sockets) {
        socket.emit('error', {
          code: ErrorCode.TOKEN_REVOKED,
          message: 'Session revoked',
        });
        socket.disconnect(true);
      }
      if (sockets.length > 0) {
        this.logger.log(
          `Disconnected ${sockets.length} revoked socket(s) for user ${payload.userId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to disconnect revoked sockets for user ${payload.userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @SubscribeMessage('requestLyric')
  async handleRequestLyric(
    @MessageBody() options: RandomLyricOptionsDto,
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.allow(client, 'requestLyric')) return;
    this.logger.log(`Lyric requested by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', {
          code: ErrorCode.NOT_FOUND,
          message: 'Session not found',
        });
        return;
      }

      // Exclude lyrics this socket has already seen so they don't repeat.
      const excludeIds = Array.from(session.seenLyricIds);

      let round;
      try {
        round = await this.gameLogicService.startRound(session.playerId, {
          ...options,
          excludeIds,
        });
      } catch (error) {
        // The unseen pool is exhausted: reset the seen set and retry so the
        // player can keep playing.
        if (error instanceof NotFoundException && excludeIds.length > 0) {
          session.seenLyricIds.clear();
          round = await this.gameLogicService.startRound(session.playerId, {
            ...options,
            excludeIds: [],
          });
        } else {
          throw error;
        }
      }

      session.currentRoundId = round.id;
      session.seenLyricIds.add(round.lyricId);

      // Emit exactly the HTTP response shape (GameLyricResponse): the lyric
      // snippet (answers hidden) plus round timing info.
      client.emit('newLyric', {
        roundId: round.id,
        issuedAt: round.issuedAt,
        expiresAt: round.expiresAt,
        answerWindowSeconds: round.answerWindowSeconds,
        id: round.lyric.id,
        lyricSnippet: round.lyric.lyricSnippet,
        category: round.lyric.category,
        decade: round.lyric.decade,
        genre: round.lyric.genre,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        client.emit('error', {
          code: ErrorCode.NOT_FOUND,
          message: 'No lyrics available',
        });
        return;
      }
      if (error instanceof DomainException) throw error;
      this.logger.error(
        'Error handling lyric request',
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to fetch lyric',
      });
    }
  }

  @SubscribeMessage('submitGuess')
  async handleSubmitGuess(
    @MessageBody() guessDto: Omit<GuessDto, 'roundId'>,
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.allow(client, 'submitGuess')) return;
    this.logger.log(`Guess submitted by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', {
          code: ErrorCode.NOT_FOUND,
          message: 'Session not found',
        });
        return;
      }

      // Guess against the round this socket was issued, once, rather than a
      // client-supplied ID that could be replayed after the answer is shown.
      const roundId = session.currentRoundId;
      if (!roundId) {
        client.emit('error', {
          code: ErrorCode.ROUND_REQUIRED,
          message: 'Request a lyric before guessing',
        });
        return;
      }
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Session not found' });
      return;
    }
    if (!session.currentRoundId) {
      client.emit('error', { message: 'No active round' });
      return;
    }

    try {
      const result = await this.gameLogicService.submitGuess(
        session.playerId,
        session.currentRoundId,
        guessDto.guess,
      );
      session.currentRoundId = undefined;
      client.emit('guessResult', result);
    } catch (error) {
      if (error instanceof DomainException) throw error;
      this.logger.error(
        'Error handling guess submission',
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to process guess',
      });
    }
  }

  @SubscribeMessage('requestHint')
  async handleRequestHint(@ConnectedSocket() client: Socket) {
    if (!this.allow(client, 'requestHint')) return;
    this.logger.log(`Hint requested by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', {
          code: ErrorCode.NOT_FOUND,
          message: 'Session not found',
        });
        return;
      }

      const roundId = session.currentRoundId;
      if (!roundId) {
        client.emit('error', {
          code: ErrorCode.ROUND_REQUIRED,
          message: 'Request a lyric before a hint',
        });
        return;
      }

      // Emits the HTTP response shape (RoundHintResponse).
      const hint = await this.gameLogicService.getHint(session.playerId, {
        roundId,
      });

      client.emit('hintResult', hint);
    } catch (error) {
      if (error instanceof DomainException) throw error;
      this.logger.error(
        'Error handling hint request',
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to fetch hint',
      });
    }
  }

  @SubscribeMessage('getSession')
  handleGetSession(@ConnectedSocket() client: Socket) {
    if (!this.allow(client, 'getSession')) return;
    const session = this.sessions.get(client.id);

    if (session) {
      client.emit('sessionInfo', {
        playerId: session.playerId,
        currentRoundId: session.currentRoundId,
      });
    } else {
      client.emit('error', {
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
      if (error instanceof WsException) {
        client.emit('error', error.getError());
        return;
      }
      this.logger.error('Error handling guess submission', error.stack);
      client.emit('error', { message: 'Failed to submit guess' });
    }
  }
}
