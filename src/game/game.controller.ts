import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  Logger,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  Param,
  ValidationPipe,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';
import { guessThrottle } from '../common/throttler/throttle.config';
import {
  GameLyricResponse,
  GuessResultResponse,
  GameStatsResponse,
  RoundHintResponse,
} from './interfaces/game-response.interface';
import { GameLogicService } from './game.service';
import { RandomLyricOptionsDto } from './dto/random-lyrics-option.dto';
import { MultipleLyricsDto } from './dto/multiple-lyrics.dto';
import { GuessDto } from './dto/guess.dto';
import { GetUser } from 'src/auth/decorators/user.decorator';
import { User } from 'src/users/entities/user.entity';

@Controller('game')
export class GameController {
  private readonly logger = new Logger(GameController.name);

  constructor(private readonly gameLogicService: GameLogicService) {}

  /**
   * GET /game/lyric - Get a random lyric for the game
   */
  @Get('lyric')
  async getRandomLyric(
    @Query(new ValidationPipe({ transform: true }))
    { sessionId, ...options }: RandomLyricOptionsDto,
    @GetUser() user: User,
  ): Promise<GameLyricResponse> {
    this.logger.log(
      `Getting random lyric with options: ${JSON.stringify(options)}`,
    );

    try {
      const lyric = await this.gameLogicService.getRandomLyric({
        ...options,
        // Pass the player's preferences so the service can use them as
        // fallback filters when no explicit genre/decade was supplied (#176).
        preferredGenre: user.preferredGenre ?? undefined,
        preferredDecade: user.preferredDecade ?? undefined,
      });
      const round = await this.gameLogicService.issueRound(
        user.id,
        lyric.id,
        sessionId,
      );

      // Return only the fields needed for the game (hide correct answers)
      return {
        roundId: round.id,
        issuedAt: round.issuedAt,
        expiresAt: round.expiresAt,
        answerWindowSeconds: round.answerWindowSeconds,
        id: lyric.id,
        lyricSnippet: lyric.lyricSnippet,
        category: lyric.category,
        decade: lyric.decade,
        genre: lyric.genre,
      };
    } catch (error) {
      this.logger.error('Error fetching random lyric', error.stack);
      throw error;
    }
  }

  /**
   * GET /game/lyrics/multiple - Get multiple random lyrics
   */
  @Get('lyrics/multiple')
  async getMultipleRandomLyrics(
    @Query(new ValidationPipe({ transform: true })) options: MultipleLyricsDto,
    @GetUser() user: User,
  ): Promise<GameLyricResponse[]> {
    this.logger.log(`Getting ${options.count} random lyrics`);

    if (options.count > 20) {
      throw new BadRequestException(
        'Cannot request more than 20 lyrics at once',
      );
    }

    try {
      const lyrics = await this.gameLogicService.getMultipleRandomLyrics(
        options.count,
        options,
      );

      return Promise.all(
        lyrics.map(async (lyric) => {
          const round = await this.gameLogicService.issueRound(
            user.id,
            lyric.id,
          );

          return {
            roundId: round.id,
            issuedAt: round.issuedAt,
            expiresAt: round.expiresAt,
            answerWindowSeconds: round.answerWindowSeconds,
            id: lyric.id,
            lyricSnippet: lyric.lyricSnippet,
            category: lyric.category,
            decade: lyric.decade,
            genre: lyric.genre,
          };
        }),
      );
    } catch (error) {
      this.logger.error('Error fetching multiple lyrics', error.stack);
      throw error;
    }
  }

  /**
   * POST /game/guess - Submit a guess for evaluation
   */
  @Throttle(guessThrottle)
  @Post('guess')
  @HttpCode(HttpStatus.OK)
  async checkGuess(
    @Body(new ValidationPipe()) guessDto: GuessDto,
    @GetUser() user: User,
  ): Promise<GuessResultResponse> {
    this.logger.log(`Checking guess for round ${guessDto.roundId}`);

    // Validate the guess
    const validation = this.gameLogicService.validateGuess(guessDto.guessValue);
    if (!validation.isValid) {
      throw new BadRequestException(validation.reason);
    }

    try {
      // The answer is only revealed here, after guessRound has closed the
      // round, so it cannot be used to score the same lyric again.
      const result = await this.gameLogicService.guessRound(user.id, guessDto);

      return {
        isCorrect: result.isCorrect,
        correctAnswer: result.correctAnswer,
        explanation: result.explanation ?? '',
        points: result.points ?? 0,
        speedBonus: result.speedBonus ?? 0,
        timedOut: result.timedOut ?? false,
        hintsUsed: result.hintsUsed ?? 0,
      };
    } catch (error) {
      this.logger.error('Error checking guess', error.stack);
      throw error;
    }
  }

  /**
   * POST /game/rounds/:id/hint - Reveal the next hint for an open round.
   * Each hint reduces the points the round can score.
   */
  @Post('rounds/:id/hint')
  @HttpCode(HttpStatus.OK)
  async useHint(
    @Param('id', ParseUUIDPipe) roundId: string,
    @GetUser() user: User,
  ): Promise<RoundHintResponse> {
    return this.gameLogicService.useHint(user.id, roundId);
  }

  /**
   * GET /game/stats - Get statistics about available lyrics
   */
  @Get('stats')
  async getLyricStats(
    @Query(new ValidationPipe({ transform: true }))
    options // Every field is optional already. Partial<> erases the class at runtime,
    // which silently disables validation, so the DTO is used directly.
    : RandomLyricOptionsDto,
  ): Promise<GameStatsResponse> {
    this.logger.log('Getting lyric statistics');

    try {
      return await this.gameLogicService.getLyricStats(options);
    } catch (error) {
      this.logger.error('Error fetching lyric statistics', error.stack);
      throw error;
    }
  }

  // /game/health has been replaced by the dedicated /health/live and
  // /health/ready endpoints provided by HealthModule (#199).
}
