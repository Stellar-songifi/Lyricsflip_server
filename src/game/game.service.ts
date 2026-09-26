import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { matchGuess, normalizeAnswer } from './guess-matcher';
import { Genre, isGenre, toGenre } from 'src/lyrics/entities/genre.enum';
import {
  In,
  IsNull,
  MoreThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { GameRound } from './entities/game-round.entity';
import {
  GameSession,
  GameSessionStatus,
} from 'src/game-sessions/entities/game-session.entity';
import { GAME_CONSTANTS } from './constants/game.constants';
import { maxRoundPoints, scoreRound } from './round-scoring.util';
import {
  RealtimeEvent,
  RoundEndedPayload,
  RoundStartedPayload,
} from 'src/realtime/realtime.events';

export interface RandomLyricOptions {
  category?: string;
  decade?: string;
  genre?: string;
  excludeIds?: number[];
  /**
   * When set, lyrics this player has already been served within the last
   * `seenWindowDays` days are excluded from the pool.
   */
  userId?: string;
  seenWindowDays?: number;
}

export interface GuessDto {
  lyricId: number;
  guessType: 'artist' | 'songTitle';
  guessValue: string;
}

export interface RoundGuessDto {
  roundId: string;
  guessType: 'artist' | 'songTitle';
  guessValue: string;
}

export interface GuessResult {
  isCorrect: boolean;
  correctAnswer: string;
  explanation?: string;
  points?: number;
  /** Part of `points` that came from answering quickly. */
  speedBonus?: number;
  /** The answer window had closed, so the guess earned nothing. */
  timedOut?: boolean;
  hintsUsed?: number;
}

/** Everything revealed so far by the hints taken on a round. */
export interface RoundHints {
  level: number;
  hintsRemaining: number;
  /** The most this round can now score. */
  maxPoints: number;
  decade?: string | null;
  wordCount?: { songTitle: number; artist: number };
  firstLetter?: { songTitle: string; artist: string };
}

export interface GameLyric {
  id: number;
  lyricSnippet: string;
  songTitle: string;
  artist: string;
  category?: string;
  decade?: string;
  genre?: string;
}

/** Session states in which a player is still in a game. */
const ACTIVE_SESSION_STATUSES = [
  GameSessionStatus.WAITING_FOR_PLAYER,
  GameSessionStatus.IN_PROGRESS,
];

@Injectable()
export class GameLogicService {
  private readonly logger = new Logger(GameLogicService.name);

  constructor(
    @InjectRepository(Lyrics)
    private lyricsRepository: Repository<Lyrics>,
    @InjectRepository(GameRound)
    private roundRepository: Repository<GameRound>,
    @InjectRepository(GameSession)
    private sessionRepository: Repository<GameSession>,
    private readonly configService: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /** Seconds a player has to answer, configurable per deployment. */
  private get answerWindowSeconds(): number {
    return (
      this.configService.get<number>('ROUND_ANSWER_WINDOW_SECONDS') ??
      GAME_CONSTANTS.LIMITS.ROUND_ANSWER_WINDOW_SECONDS
    );
  }

  /**
   * Records that a lyric has been served to a player, opening the one round
   * that player can guess it in.
   *
   * `issuedAt` is set here, from the server clock, and is what the answer
   * window is measured against when the guess arrives.
   */
  async issueRound(
    userId: string,
    lyricId: number,
    sessionId?: string,
  ): Promise<GameRound> {
    if (sessionId) {
      await this.assertActiveParticipant(userId, sessionId);
    }

    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + GAME_CONSTANTS.LIMITS.ROUND_TIMEOUT_SECONDS * 1000,
    );

    const round = await this.roundRepository.save(
      this.roundRepository.create({
        userId,
        lyricId,
        sessionId: sessionId ?? null,
        issuedAt,
        expiresAt,
        answerWindowSeconds: this.answerWindowSeconds,
        hintsUsed: 0,
        closedAt: null,
      }),
    );

    if (sessionId) {
      await this.touchSession(sessionId);
    }

    const payload: RoundStartedPayload = {
      roundId: round.id,
      sessionId: round.sessionId ?? null,
      userId,
      issuedAt: round.issuedAt,
      expiresAt: round.expiresAt,
      answerWindowSeconds: round.answerWindowSeconds,
    };
    this.events.emit(RealtimeEvent.ROUND_STARTED, payload);

    return round;
  }

  /**
   * Scores a guess against a round served to this player, and closes it.
   *
   * The round is closed with a conditional update before the answer is looked
   * at, so two concurrent guesses cannot both be scored and the answer the
   * first one reveals cannot be replayed.
   *
   * A guess that arrives after the answer window is still evaluated, but earns
   * no points, so looking the answer up elsewhere gains nothing.
   */
  async guessRound(userId: string, dto: RoundGuessDto): Promise<GuessResult> {
    const round = await this.roundRepository.findOne({
      where: { id: dto.roundId, userId },
    });

    // Someone else's round is reported the same as a missing one, so round IDs
    // cannot be probed.
    if (!round) {
      throw new NotFoundException('Round not found');
    }

    if (round.closedAt) {
      throw new ConflictException('This round has already been guessed');
    }

    const now = new Date();

    if (round.expiresAt.getTime() <= now.getTime()) {
      await this.roundRepository.update(
        { id: round.id, closedAt: IsNull() },
        { closedAt: now },
      );
      this.emitRoundEnded(round, {
        isCorrect: false,
        points: 0,
        speedBonus: 0,
        timedOut: true,
      });
      throw new GoneException('This round has expired');
    }

    const closed = await this.roundRepository.update(
      { id: round.id, closedAt: IsNull() },
      { closedAt: now },
    );

    if (!closed.affected) {
      throw new ConflictException('This round has already been guessed');
    }

    const result = await this.checkGuess({
      lyricId: round.lyricId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });

    const score = scoreRound({
      basePoints: result.points ?? 0,
      isCorrect: result.isCorrect,
      elapsedMs: now.getTime() - round.issuedAt.getTime(),
      windowMs: round.answerWindowSeconds * 1000,
      hintsUsed: round.hintsUsed,
    });

    const scored: GuessResult = {
      ...result,
      points: score.points,
      speedBonus: score.speedBonus,
      timedOut: score.timedOut,
      hintsUsed: round.hintsUsed,
    };

    if (score.timedOut) {
      scored.explanation = `Too late, no points awarded. ${result.explanation}`;
    }

    this.emitRoundEnded(round, {
      isCorrect: result.isCorrect && !score.timedOut,
      points: score.points,
      speedBonus: score.speedBonus,
      timedOut: score.timedOut,
    });

    if (round.sessionId) {
      await this.touchSession(round.sessionId);
    }

    return scored;
  }

  /**
   * Reveals the next hint for an open round: the decade, then the word count,
   * then the first letter. Each hint lowers the points the round can score, so
   * nothing is revealed for free.
   *
   * Hints are refused for anyone in an active wagered session, since one
   * player could otherwise buy an edge the other cannot.
   */
  async useHint(userId: string, roundId: string): Promise<RoundHints> {
    const round = await this.roundRepository.findOne({
      where: { id: roundId, userId },
    });

    if (!round) {
      throw new NotFoundException('Round not found');
    }

    if (round.closedAt) {
      throw new ConflictException('This round has already been guessed');
    }

    if (round.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This round has expired');
    }

    await this.assertHintsAllowed(userId);

    if (round.hintsUsed >= GAME_CONSTANTS.LIMITS.MAX_HINTS) {
      throw new ConflictException('No more hints are available for this round');
    }

    // Conditional on the count read above, so two simultaneous requests cannot
    // both take the same hint level (or skip past one).
    const taken = await this.roundRepository.update(
      { id: round.id, closedAt: IsNull(), hintsUsed: round.hintsUsed },
      { hintsUsed: round.hintsUsed + 1 },
    );

    if (!taken.affected) {
      throw new ConflictException('This round changed, try the hint again');
    }

    const lyric = await this.lyricsRepository.findOne({
      where: { id: round.lyricId, isActive: true },
    });

    if (!lyric) {
      throw new NotFoundException('Round not found');
    }

    return this.buildHints(lyric, round.hintsUsed + 1);
  }

  private buildHints(lyric: Lyrics, level: number): RoundHints {
    const words = (text: string) =>
      normalizeAnswer(text).split(' ').filter(Boolean).length;
    const initial = (text: string) =>
      normalizeAnswer(text).charAt(0).toUpperCase();

    const hints: RoundHints = {
      level,
      hintsRemaining: GAME_CONSTANTS.LIMITS.MAX_HINTS - level,
      maxPoints: maxRoundPoints(level),
      decade: lyric.decade ?? null,
    };

    if (level >= 2) {
      hints.wordCount = {
        songTitle: words(lyric.songTitle),
        artist: words(lyric.artist),
      };
    }

    if (level >= 3) {
      hints.firstLetter = {
        songTitle: initial(lyric.songTitle),
        artist: initial(lyric.artist),
      };
    }

    return hints;
  }

  private async assertHintsAllowed(userId: string): Promise<void> {
    const wagered = await this.sessionRepository.count({
      where: [
        {
          hasWager: true,
          status: In(ACTIVE_SESSION_STATUSES),
          player: { id: userId },
        },
        {
          hasWager: true,
          status: In(ACTIVE_SESSION_STATUSES),
          playerTwoId: userId,
        },
      ],
    });

    if (wagered > 0) {
      throw new BadRequestException('Hints are not available in wagered games');
    }
  }

  /** A round can only be tied to a session the player is actually playing. */
  private async assertActiveParticipant(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, status: In(ACTIVE_SESSION_STATUSES) },
      relations: { player: true },
    });

    if (
      !session ||
      (session.player?.id !== userId && session.playerTwoId !== userId)
    ) {
      throw new NotFoundException('Session not found');
    }
  }

  /** Playing a round counts as activity, so a busy session is never idle. */
  private async touchSession(sessionId: string): Promise<void> {
    await this.sessionRepository.update(sessionId, { updatedAt: new Date() });
  }

  private emitRoundEnded(
    round: GameRound,
    outcome: Pick<
      RoundEndedPayload,
      'isCorrect' | 'points' | 'speedBonus' | 'timedOut'
    >,
  ): void {
    const payload: RoundEndedPayload = {
      roundId: round.id,
      sessionId: round.sessionId ?? null,
      userId: round.userId,
      hintsUsed: round.hintsUsed,
      ...outcome,
    };
    this.events.emit(RealtimeEvent.ROUND_ENDED, payload);
  }

  /**
   * Returns the IDs of lyrics this player has already been served within the
   * configured window, so they are not repeated while unseen lyrics remain.
   */
  private async getRecentlySeenLyricIds(
    userId: string,
    windowDays: number,
  ): Promise<number[]> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rounds = await this.roundRepository.find({
      where: { userId, issuedAt: MoreThanOrEqual(since) },
      select: ['lyricId'],
    });

    return rounds.map((round) => round.lyricId);
  }

  /**
   * Fetches a random lyric from the database with optional filtering
   * @param options - Filtering options for category, decade, genre, and exclusions
   * @returns Promise<GameLyric> - Random lyric for the game
   */
  async getRandomLyric(options: RandomLyricOptions = {}): Promise<GameLyric> {
    this.logger.debug(
      `Fetching random lyric with options: ${JSON.stringify(options)}`,
    );

    try {
      // Build the query with optional filters
      const queryBuilder = this.lyricsRepository
        .createQueryBuilder('lyrics')
        .select([
          'lyrics.id',
          'lyrics.lyricSnippet',
          'lyrics.songTitle',
          'lyrics.artist',
          'lyrics.category',
          'lyrics.decade',
          'lyrics.genre',
        ]);

      this.applyFilters(queryBuilder, options);

      // Exclude previously shown lyrics in the session
      if (options.excludeIds && options.excludeIds.length > 0) {
        queryBuilder.andWhere('lyrics.id NOT IN (:...excludeIds)', {
          excludeIds: options.excludeIds,
        });
      }

      // Exclude lyrics this player has already seen within the window.
      if (options.userId && options.seenWindowDays) {
        const seenIds = await this.getRecentlySeenLyricIds(
          options.userId,
          options.seenWindowDays,
        );

        if (seenIds.length > 0) {
          queryBuilder.andWhere('lyrics.id NOT IN (:...seenIds)', {
            seenIds,
          });
        }
      }

      // Pick a random row without a COUNT + OFFSET scan: order by a random
      // expression and take the first row.
      const lyric = await queryBuilder.orderBy('RANDOM()').take(1).getOne();

      if (lyric) {
        this.logger.debug(`Selected lyric ID: ${lyric.id}`);

        return {
          id: lyric.id,
          lyricSnippet: lyric.lyricSnippet,
          songTitle: lyric.songTitle,
          artist: lyric.artist,
          category: lyric.category,
          decade: lyric.decade,
          genre: lyric.genre,
        };
      }

      // The unseen pool is exhausted: fall back to the full filtered pool so
      // the player still gets a lyric instead of an error.
      if (options.userId && options.seenWindowDays) {
        this.logger.debug(
          'Unseen lyric pool exhausted, falling back to full pool',
        );
        return this.getRandomLyric({
          ...options,
          userId: undefined,
          seenWindowDays: undefined,
        });
      }

      throw new NotFoundException(
        'No lyrics found matching the specified criteria',
      );
    } catch (error) {
      this.logger.error('Error fetching random lyric', error.stack);
      throw error;
    }
  }

  /**
   * Checks if a player's guess is correct
   * @param guessDto - The guess data containing lyricId, guessType, and guessValue
   * @returns Promise<GuessResult> - Result of the guess evaluation
   */
  async checkGuess(guessDto: GuessDto): Promise<GuessResult> {
    this.logger.debug(`Checking guess: ${JSON.stringify(guessDto)}`);

    try {
      // Fetch the lyric from database
      const lyric = await this.lyricsRepository.findOne({
        // A deactivated lyric is treated as if it does not exist.
        where: { id: guessDto.lyricId, isActive: true },
      });

      if (!lyric) {
        throw new NotFoundException(
          `Lyric with ID ${guessDto.lyricId} not found`,
        );
      }

      // Get the correct answer based on guess type
      const correctAnswer =
        guessDto.guessType === 'artist' ? lyric.artist : lyric.songTitle;

      const { isCorrect, isExactMatch, points } = matchGuess(
        guessDto.guessValue,
        correctAnswer,
      );

      // Generate explanation
      let explanation = '';
      if (isCorrect) {
        if (isExactMatch) {
          explanation = `Correct! This line is from "${lyric.songTitle}" by ${lyric.artist}.`;
        } else {
          explanation = `Close enough! The exact answer is "${correctAnswer}" from "${lyric.songTitle}" by ${lyric.artist}.`;
        }
      } else {
        explanation = `Incorrect. The correct answer is "${correctAnswer}" from "${lyric.songTitle}" by ${lyric.artist}.`;
      }

      const result: GuessResult = {
        isCorrect,
        correctAnswer,
        explanation,
        points,
      };

      this.logger.debug(`Guess result: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error('Error checking guess', error.stack);
      throw error;
    }
  }

  /**
   * Gets multiple random lyrics for batch operations
   * @param count - Number of lyrics to fetch
   * @param options - Filtering options
   * @returns Promise<GameLyric[]> - Array of random lyrics
   */
  async getMultipleRandomLyrics(
    count: number,
    options: RandomLyricOptions = {},
  ): Promise<GameLyric[]> {
    this.logger.debug(`Fetching ${count} random lyrics`);

    const lyrics: GameLyric[] = [];
    const excludeIds = options.excludeIds || [];

    for (let i = 0; i < count; i++) {
      try {
        const lyric = await this.getRandomLyric({
          ...options,
          excludeIds: [...excludeIds, ...lyrics.map((l) => l.id)],
        });
        lyrics.push(lyric);
      } catch (error) {
        this.logger.warn(
          `Could not fetch lyric ${i + 1} of ${count}: ${error.message}`,
        );
        break;
      }
    }

    return lyrics;
  }

  /**
   * Gets statistics about available lyrics
   * @param options - Optional filtering
   * @returns Promise with counts and categories
   */
  async getLyricStats(options: Partial<RandomLyricOptions> = {}) {
    this.logger.debug('Fetching lyric statistics');

    try {
      const queryBuilder = this.lyricsRepository.createQueryBuilder('lyrics');
      this.applyFilters(queryBuilder, options);

      const [totalCount, categories, decades, genres] = await Promise.all([
        queryBuilder.getCount(),
        this.lyricsRepository
          .createQueryBuilder('lyrics')
          .select('DISTINCT lyrics.category', 'category')
          .where('lyrics.category IS NOT NULL')
          .andWhere('lyrics.isActive = :isActive', { isActive: true })
          .getRawMany(),
        this.lyricsRepository
          .createQueryBuilder('lyrics')
          .select('DISTINCT lyrics.decade', 'decade')
          .where('lyrics.decade IS NOT NULL')
          .andWhere('lyrics.isActive = :isActive', { isActive: true })
          .orderBy('lyrics.decade', 'ASC')
          .getRawMany(),
        this.lyricsRepository
          .createQueryBuilder('lyrics')
          .select('DISTINCT lyrics.genre', 'genre')
          .where('lyrics.genre IS NOT NULL')
          .andWhere('lyrics.isActive = :isActive', { isActive: true })
          .getRawMany(),
      ]);

      return {
        totalCount,
        availableCategories: categories.map((c) => c.category).filter(Boolean),
        availableDecades: decades.map((d) => d.decade).filter(Boolean),
        availableGenres: genres.map((g) => g.genre).filter(Boolean),
      };
    } catch (error) {
      this.logger.error('Error fetching lyric statistics', error.stack);
      throw error;
    }
  }

  /**
   * Applies the shared gameplay filters. Deactivated lyrics are always
   * excluded, so an admin removal takes effect for players immediately.
   */
  private applyFilters(
    queryBuilder: SelectQueryBuilder<Lyrics>,
    options: Partial<RandomLyricOptions>,
  ): void {
    queryBuilder.andWhere('lyrics.isActive = :isActive', { isActive: true });

    if (options.category) {
      queryBuilder.andWhere('LOWER(lyrics.category) = LOWER(:category)', {
        category: options.category,
      });
    }

    if (options.decade) {
      queryBuilder.andWhere('lyrics.decade = :decade', {
        decade: options.decade,
      });
    }

    if (options.genre) {
      // genre is a Postgres enum and LOWER() has no enum overload, so resolve
      // the value to the enum here and compare the column directly.
      queryBuilder.andWhere('lyrics.genre = :genre', {
        genre: this.resolveGenre(options.genre),
      });
    }
  }

  /**
   * Maps a genre case-insensitively onto the Genre enum. The HTTP DTO already
   * validates it, but the WebSocket gateway does not, and an unknown value
   * would otherwise reach Postgres as an invalid enum literal.
   */
  private resolveGenre(genre: string): Genre {
    const resolved = toGenre(genre);
    if (!isGenre(resolved)) {
      throw new BadRequestException(
        `genre must be one of: ${Object.values(Genre).join(', ')}`,
      );
    }
    return resolved;
  }

  /**
   * Validates if a guess is reasonable (not empty, reasonable length)
   * @param guess - The guess string to validate
   */
  validateGuess(guess: string): { isValid: boolean; reason?: string } {
    if (!guess || typeof guess !== 'string') {
      return { isValid: false, reason: 'Guess cannot be empty' };
    }

    const trimmedGuess = guess.trim();
    if (trimmedGuess.length === 0) {
      return { isValid: false, reason: 'Guess cannot be empty' };
    }

    if (trimmedGuess.length > 200) {
      return {
        isValid: false,
        reason: 'Guess is too long (max 200 characters)',
      };
    }

    return { isValid: true };
  }

  /** Normalizes a string for comparison (case, punctuation, whitespace). */
  private normalizeString(str: string): string {
    return normalizeAnswer(str);
  }
}
