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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import { Genre } from '../lyrics/entities/genre.enum';

@ApiTags('game')
@Controller('game')
export class GameController {
  private readonly logger = new Logger(GameController.name);

  constructor(private readonly gameLogicService: GameLogicService) {}

  /**
   * GET /game/lyric - Get a random lyric for the game
   */
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a random lyric for the current game round' })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'decade', required: false, type: String })
  @ApiQuery({ name: 'genre', required: false, type: String })
  @ApiQuery({ name: 'excludeIds', required: false, type: [Number] })
  @ApiResponse({
    status: 200,
    description: 'A playable lyric and a round id.',
    type: Object,
  })
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
        // Only forward the preferred genre when it is a valid lyric genre;
        // otherwise the fallback would throw a 400 for stored preferences
        // that are not part of the lyric `Genre` enum (#310).
        preferredGenre: this.toLyricGenre(user.preferredGenre),
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
   * Returns the value as a lyric `Genre` when it is one, otherwise
   * `undefined` so the preference fallback is simply skipped.
   */
  private toLyricGenre(value?: string | null): Genre | undefined {
    if (!value) {
      return undefined;
    }
    const genres = Object.values(Genre) as string[];
    return genres.includes(value) ? (value as Genre) : undefined;
  }

  /**
   * GET /game/lyrics/multiple - Get multiple random lyrics
   */
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get multiple random lyrics for the current user' })
  @ApiQuery({ name: 'count', required: true, type: Number })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'decade', required: false, type: String })
  @ApiQuery({ name: 'genre', required: false, type: String })
  @ApiQuery({ name: 'excludeIds', required: false, type: [Number] })
  @ApiResponse({
    status: 200,
    description: 'A list of playable lyrics.',
    type: [Object],
  })
  @Get('lyrics/multiple')
  async getMultipleRandomLyrics(
    @Query(new ValidationPipe({ transform: true }))
    { sessionId, ...options }: MultipleLyricsDto,
    @GetUser() user: User,
  ): Promise<GameLyricResponse[]> {
    this.logger.log(`Getting ${options.count} random lyrics`);

    if (options.count > 20) {
      throw new BadRequestException(
        'Cannot request more than 20 lyrics at once',
      );
    }

    try {
      // Mirror the single-lyric endpoint: forward the player's preferences
      // and seen window so the batch honours the same filters (#332).
      const lyrics = await this.gameLogicService.getMultipleRandomLyrics(
        options.count,
        {
          ...options,
          preferredGenre: this.toLyricGenre(user.preferredGenre),
          preferredDecade: user.preferredDecade ?? undefined,
          userId: user.id,
        },
      );

      // Issue all rounds in a single statement tied to the session.
      const rounds = await this.gameLogicService.issueRounds(
        user.id,
        lyrics.map((lyric) => lyric.id),
        sessionId,
      );

      return lyrics.map((lyric, index) => {
        const round = rounds[index];

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
      });
    } catch (error) {
      this.logger.error('Error fetching multiple lyrics', error.stack);
      throw error;
    }
  }

  /**
   * POST /game/guess - Submit a guess for evaluation
   */
  @Throttle(guessThrottle)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit a guess for the active round' })
  @ApiBody({ type: GuessDto })
  @ApiResponse({
    status: 200,
    description: 'The guess result including correctness and points.',
    type: Object,
  })
  @ApiResponse({ status: 400, description: 'Invalid guess payload or guess not allowed.' })
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
   *
   * Hint levels (each reveals new information not already shown with the round):
   * 1. Genre plus the number of words in the song title.
   * 2. The decade the song was released in.
   * 3. The first letter of the song title.
   */
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reveal the next hint for an open round',
    description:
      'Reveals the next hint level for the round and reduces the round\'s ' +
      'scoreable points. Level 1 reveals the genre and the number of words in ' +
      'the song title, level 2 reveals the decade, and level 3 reveals the ' +
      'first letter of the song title. Each level reveals information the ' +
      'player did not already have.',
  })
  @ApiResponse({
    status: 200,
    description: 'The revealed hint and the remaining scoreable points.',
    type: Object,
  })
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
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get lyrical stats for the available pool' })
  @ApiResponse({
    status: 200,
    description: 'Aggregate lyric statistics.',
    type: Object,
  })
  @Get('stats')
  async getLyricStats(
    @Query(new ValidationPipe({ transform: true }))
    options // Every field is optional already. Partial<> erases the class at runtime,
    // which silently disables validation, so the DTO is used directly.
    : RandomLyricOptionsDto,
  ):

/* … truncated 414 chars — edit only what you need near the top … */
