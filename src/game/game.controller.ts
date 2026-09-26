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
  ValidationPipe,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';
import { guessThrottle } from '../common/throttler/throttle.config';
import {
  GameLyricResponse,
  GuessResultResponse,
  GameStatsResponse,
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
    options: RandomLyricOptionsDto,
    @GetUser() user: User,
  ): Promise<GameLyricResponse> {
    this.logger.log(
      `Getting random lyric with options: ${JSON.stringify(options)}`,
    );

    try {
      const lyric = await this.gameLogicService.getRandomLyric(options);
      const round = await this.gameLogicService.issueRound(user.id, lyric.id);

      // Return only the fields needed for the game (hide correct answers)
      return {
        roundId: round.id,
        expiresAt: round.expiresAt,
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
            expiresAt: round.expiresAt,
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
      };
    } catch (error) {
      this.logger.error('Error checking guess', error.stack);
      throw error;
    }
  }

  /**
   * GET /game/stats - Get statistics about available lyrics
   */
  @Get('stats')
  async getLyricStats(
    @Query(new ValidationPipe({ transform: true }))
    // Every field is optional already. Partial<> erases the class at runtime,
    // which silently disables validation, so the DTO is used directly.
    options: RandomLyricOptionsDto,
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
