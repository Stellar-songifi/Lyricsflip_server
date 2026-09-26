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
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GameLogicService } from './game.service';
import { RandomLyricOptionsDto } from './dto/random-lyrics-option.dto';
import { GuessDto } from './dto/guess.dto';

interface GameSession {
  playerId: string;
  score: number;
  streak: number;
  currentLyric?: any;
  /** Lyric IDs already served to this player, to avoid repeats. */
  seenLyricIds: Set<string>;
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        { secret: this.configService.get<string>('JWT_SECRET') },
      );
      userId = payload.sub;
    } catch {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    this.logger.log(`Client connected: ${client.id} (user ${userId})`);

    // Initialize session, keyed by user ID (replaces any stale one)
    this.sessions.set(userId, {
      playerId: userId,
      score: 0,
      streak: 0,
      seenLyricIds: new Set<string>(),
    });

    client.emit('connected', {
      message: 'Connected to LyricFlip game!',
      sessionId: userId,
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const userId = client.data?.userId;
    if (userId) this.sessions.delete(userId);
  }

  @SubscribeMessage('requestLyric')
  async handleRequestLyric(
    @MessageBody() options: RandomLyricOptionsDto,
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Lyric requested by ${client.id}`);

    try {
      const session = this.sessions.get(client.data.userId);
      if (!session) {
        client.emit('error', { message: 'Session not found' });
        return;
      }

      // Exclude lyrics this player has already seen so they don't repeat.
      const excludeIds = Array.from(session.seenLyricIds);
      if (session.currentLyric) excludeIds.push(session.currentLyric.id);

      let lyric = await this.gameLogicService.getRandomLyric({
        ...options,
        excludeIds,
      });

      // Fall back gracefully when the unseen pool is exhausted: reset the
      // seen set and retry so the player can keep playing.
      if (!lyric && excludeIds.length > 0) {
        session.seenLyricIds.clear();
        lyric = await this.gameLogicService.getRandomLyric({
          ...options,
          excludeIds: session.currentLyric ? [session.currentLyric.id] : [],
        });
      }

      if (!lyric) {
        client.emit('error', { message: 'No lyrics available' });
        return;
      }

      // Store current lyric in session and remember it as seen
      session.currentLyric = lyric;
      session.seenLyricIds.add(lyric.id);

      // Send only the lyric snippet (hide answers)
      client.emit('newLyric', {
        id: lyric.id,
        lyricSnippet: lyric.lyricSnippet,
        category: lyric.category,
        decade: lyric.decade,
        genre: lyric.genre,
      });
    } catch (error) {
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
      const session = this.sessions.get(client.data.userId);
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

      // Guess against the lyric this socket was served, once, rather than a
      // client-supplied ID that could be replayed after the answer is shown.
      const lyric = session.currentLyric;
      if (!lyric) {
        client.emit('error', { message: 'Request a lyric before guessing' });
        return;
      }
      session.currentLyric = undefined;

      const result = await this.gameLogicService.checkGuess({
        lyricId: lyric.id,
        guessType: guessDto.guessType,
        guessValue: guessDto.guessValue,
      });

      // Update session stats
      if (result.isCorrect) {
        session.score += result.points ?? 0;
        session.streak += 1;
      } else {
        session.streak = 0;
      }

      // Send result with updated session info
      client.emit('guessResult', {
        ...result,
        session: {
          score: session.score,
          streak: session.streak,
        },
      });
    } catch (error) {
      this.logger.error('Error handling guess submission', error.stack);
      client.emit('error', { message: 'Failed to process guess' });
    }
  }

  @SubscribeMessage('getSession')
  handleGetSession(@ConnectedSocket() client: Socket) {
    const session = this.sessions.get(client.data.userId);

    if (session) {
      client.emit('sessionInfo', {
        score: session.score,
        streak: session.streak,
        playerId: session.playerId,
      });
    } else {
      client.emit('error', { message: 'Session not found' });
    }
  }
}
