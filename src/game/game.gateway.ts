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
import { Logger, ValidationPipe } from '@nestjs/common';
import { GameLogicService } from './game.service';
import { RandomLyricOptionsDto } from './dto/random-lyrics-option.dto';
import { GuessDto } from './dto/guess.dto';

interface GameSession {
  playerId: string;
  score: number;
  streak: number;
  currentLyric?: any;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  private sessions = new Map<string, GameSession>();

  constructor(private readonly gameLogicService: GameLogicService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Initialize session
    this.sessions.set(client.id, {
      playerId: client.id,
      score: 0,
      streak: 0,
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

      // Get previously shown lyrics to avoid repetition
      const excludeIds = session.currentLyric ? [session.currentLyric.id] : [];

      const lyric = await this.gameLogicService.getRandomLyric({
        ...options,
        excludeIds,
      });

      // Store current lyric in session
      session.currentLyric = lyric;

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
    const session = this.sessions.get(client.id);

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
