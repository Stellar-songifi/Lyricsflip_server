import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, NotFoundException, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GameLogicService } from './game.service';
import { RandomLyricOptionsDto } from './dto/random-lyrics-option.dto';
import { GuessDto } from './dto/guess.dto';
import type { SocketUser } from '../auth/auth-context.util';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

interface GameSession {
  playerId: string;
  /** Round currently open for this socket, if any. */
  currentRoundId?: string;
  /** Lyric IDs already served to this socket, to avoid repeats. */
  seenLyricIds: Set<number>;
}

@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new WsException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.map((error) => ({
          field: error.property,
          messages: Object.values(error.constraints ?? {}),
        })),
      }),
  }),
)
@WebSocketGateway({
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
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  // Socket-local state keyed by client.id so two tabs of the same user play
  // independently. Authoritative round/score state lives in the database.
  private sessions = new Map<string, GameSession>();

  constructor(
    private readonly gameLogicService: GameLogicService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    let userId: string;
    let user: SocketUser;
    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<
        Pick<JwtPayload, 'sub' | 'username' | 'role'>
      >(token, { secret: this.configService.get<string>('JWT_SECRET') });
      userId = payload.sub;
      user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
    } catch {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    // Read by @GetUser, RolesGuard and JwtAuthGuard in handlers (#362).
    client.data.user = user;
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

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.sessions.delete(client.id);
  }

  @SubscribeMessage('requestLyric')
  async handleRequestLyric(
    @MessageBody() options: RandomLyricOptionsDto,
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Lyric requested by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', { message: 'Session not found' });
        return;
      }

      // Exclude lyrics this socket has already seen so they don't repeat.
      const excludeIds = Array.from(session.seenLyricIds);

      let round;
      try {
        round = await this.gameLogicService.issueRound(
          session.playerId,
          { ...options, excludeIds },
        );
      } catch (error) {
        // The unseen pool is exhausted: reset the seen set and retry so the
        // player can keep playing.
        if (error instanceof NotFoundException && excludeIds.length > 0) {
          session.seenLyricIds.clear();
          round = await this.gameLogicService.issueRound(
            session.playerId,
            { ...options, excludeIds: [] },
          );
        } else {
          throw error;
        }
      }

      session.currentRoundId = round.roundId;
      session.seenLyricIds.add(round.lyric.id);

      // Send only the lyric snippet (hide answers) plus round timing info.
      client.emit('newLyric', {
        roundId: round.roundId,
        issuedAt: round.issuedAt,
        answerWindowSeconds: round.answerWindowSeconds,
        id: round.lyric.id,
        lyricSnippet: round.lyric.lyricSnippet,
        category: round.lyric.category,
        decade: round.lyric.decade,
        genre: round.lyric.genre,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        client.emit('error', { message: 'No lyrics available' });
        return;
      }
      this.logger.error('Error handling lyric request', error.stack);
      client.emit('error', { message: 'Failed to fetch lyric' });
    }
  }

  @SubscribeMessage('submitGuess')
  async handleSubmitGuess(
    @MessageBody() guessDto: Omit<GuessDto, 'roundId'>,
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Guess submitted by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', { message: 'Session not found' });
        return;
      }

      // Validate guess
      const validation = this.gameLogicService.validateGuess(
        guessDto.guessValue,
      );
      if (!validation.isValid) {
        client.emit('error', { message: validation.reason });
        return;
      }

      // Guess against the round this socket was issued, once, rather than a
      // client-supplied ID that could be replayed after the answer is shown.
      const roundId = session.currentRoundId;
      if (!roundId) {
        client.emit('error', { message: 'Request a lyric before guessing' });
        return;
      }
      session.currentRoundId = undefined;

      const result = await this.gameLogicService.guessRound(
        session.playerId,
        roundId,
        {
          guessType: guessDto.guessType,
          guessValue: guessDto.guessValue,
        },
      );

      client.emit('guessResult', result);
    } catch (error) {
      this.logger.error('Error handling guess submission', error.stack);
      client.emit('error', { message: 'Failed to process guess' });
    }
  }

  @SubscribeMessage('requestHint')
  async handleRequestHint(@ConnectedSocket() client: Socket) {
    this.logger.log(`Hint requested by ${client.id}`);

    try {
      const session = this.sessions.get(client.id);
      if (!session) {
        client.emit('error', { message: 'Session not found' });
        return;
      }

      const roundId = session.currentRoundId;
      if (!roundId) {
        client.emit('error', { message: 'Request a lyric before a hint' });
        return;
      }

      const hint = await this.gameLogicService.useHint(
        session.playerId,
        roundId,
      );

      client.emit('hintResult', hint);
    } catch (error) {
      this.logger.error('Error handling hint request', error.stack);
      client.emit('error', { message: 'Failed to fetch hint' });
    }
  }

  @SubscribeMessage('getSession')
  handleGetSession(@ConnectedSocket() client: Socket) {
    const session = this.sessions.get(client.id);

    if (session) {
      client.emit('sessionInfo', {
        playerId: session.playerId,
        currentRoundId: session.currentRoundId,
      });
    } else {
      client.emit('error', { message: 'Session not found' });
    }
  }
}
