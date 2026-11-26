import { recordReferralRound } from '../referrals/referral-rewards.service';
import {
  DomainException,
  ErrorCode,
} from '../common/exceptions/domain.exception';
import {
  HttpStatus,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { JobLockService } from '../jobs/job-lock.service';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { matchGuess } from './guess-matcher';
import { Genre, isGenre, toGenre } from '../lyrics/entities/genre.enum';
import {
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { GameRound } from './entities/game-round.entity';
import {
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import { GAME_CONSTANTS } from './constants/game.constants';
import { maxRoundPoints, scoreRound } from './round-scoring.util';
import {
  RealtimeEvent,
  RoundEndedPayload,
  RoundStartedPayload,
} from '../realtime/realtime.events';

export interface RandomLyricOptions {
  category?: string;
  decade?: string;
  genre?: string;
  excludeIds?: number[];
  /** Session the round belongs to, when started from a multiplayer game. */
  sessionId?: string;
  /**
   * When set, lyrics this player has already been served within the last
   * `seenWindowDays` days are excluded from the pool.
   */
  userId?: string;
  seenWindowDays?: number;
  /**
   * Genre to fall back to when no explicit genre filter was given (sourced from
   * the player's preferredGenre). Ignored when `ignorePreferences` is true.
   */
  preferredGenre?: string;
  /**
   * Decade to fall back to when no explicit decade filter was given (sourced
   * from the player's preferredDecade). Ignored when `ignorePreferences` is
   * true.
   */
  preferredDecade?: string;
  /**
   * When true, preferredGenre / preferredDecade are not applied even if they
   * are set.
   */
  ignorePreferences?: boolean;
  /**
   * Exact difficulty level (1–5) the lyric must match. When omitted all levels
   * are accepted.
   */
  difficulty?: number;
}

export interface RoundGuessDto {
  roundId: string;
  guessType: 'artist' | 'songTitle';
  guessValue: string;
}

/** Internal shape used by the legacy {@link GameLogicService.checkGuess} method. */
export interface LyricGuessDto {
  lyricId: number;
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
  genre?: string | null;
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
    private readonly jobLockService: JobLockService,
  ) {}

  /** Seconds a player has to answer, configurable per deployment. */
  private get answerWindowSeconds(): number {
    return (
      this.configService.get<number>('ROUND_ANSWER_WINDOW_SECONDS') ??
      GAME_CONSTANTS.LIMITS.ROUND_ANSWER_WINDOW_SECONDS
    );
  }

  /** Days a served lyric is excluded from a player's pool (the seen window). */
  private get seenWindowDays(): number {
    return (
      this.configService.get<number>('GAME_SEEN_WINDOW_DAYS') ??
      GAME_CONSTANTS.LIMITS.SEEN_WINDOW_DAYS
    );
  }

  /** Days a guessed round is kept before it is archived or deleted. */
  private get roundRetentionDays(): number {
    return (
      this.configService.get<number>('GAME_ROUND_RETENTION_DAYS') ??
      GAME_CONSTANTS.LIMITS.ROUND_RETENTION_DAYS
    );
  }

  /**
   * Picks a lyric for this player and opens the round they can guess it in.
   *
   * This is the single entry point shared by the HTTP controller and the
   * `/game` socket gateway, so both surfaces serve identical payloads.
   */
  async startRound(
    userId: string,
    options: RandomLyricOptions = {},
  ): Promise<{ round: GameRound; lyric: GameLyric }> {
    const lyric = await this.getRandomLyric({
      ...options,
      userId,
      seenWindowDays: options.seenWindowDays ?? this.seenWindowDays,
    });

    const round = await this.issueRound(userId, lyric.id, options.sessionId);

    return { round, lyric };
  }

  /**
   * Records that a lyric has been served to a player, opening the one round
   * that player can guess it in.
   *
   * `issuedAt` is set here, from the server clock, and is what the answer
   * window is measured against when the guess arrives.
   *
   * Pass `dailyDate` (a `YYYY-MM-DD` string) to tag the round as belonging to
   * the daily challenge for that date. Daily rounds are looked up by
   * `(userId, dailyDate, lyricId)` so they can be reused across requests.
   */
  async issueRound(
    userId: string,
    lyricId: number,
    sessionId?: string,
    dailyDate?: string,
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
        dailyDate: dailyDate ?? null,
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
   * Daily retention job for `game_rounds`.
   *
   * - Unguessed rounds older than the seen window are deleted: they no longer
   *   affect the seen-window query and were never scored.
   * - Guessed rounds older than `roundRetentionDays` are deleted once
   *   `game_history` holds the record; otherwise they are moved into the
   *   `game_rounds_archive` table.
   *
   * A Postgres advisory lock (via {@link JobLockService}) ensures only one
   * instance runs the job at a time.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneGameRounds(): Promise<void> {
    await this.jobLockService.runExclusive('game-rounds-prune', async () => {
      try {
        const now = Date.now();
        const seenCutoff = new Date(
          now - this.seenWindowDays * 24 * 60 * 60 * 1000,
        );
        const retentionCutoff = new Date(
          now - this.roundRetentionDays * 24 * 60 * 60 * 1000,
        );

        const unguessed = await this.roundRepository.delete({
          closedAt: IsNull(),
          issuedAt: LessThan(seenCutoff),
        });

        const archived = await this.archiveGuessedRounds(retentionCutoff);

        const deleted = await this.roundRepository.delete({
          closedAt: LessThan(retentionCutoff),
          issuedAt: LessThan(retentionCutoff),
        });

        this.logger.log(
          `game_rounds retention: deleted ${unguessed.affected ?? 0} unguessed, ` +
            `archived ${archived} guessed, deleted ${deleted.affected ?? 0} archived`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `game_rounds retention job failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    });
  }

  /**
   * Moves guessed rounds older than `cutoff` into `game_rounds_archive` when
   * `game_history` does not already hold the record, then deletes the moved
   * rows from `game_rounds`. Returns the number of rows archived.
   */
  private async archiveGuessedRounds(cutoff: Date): Promise<number> {
    const result = await this.roundRepository.query(
      `WITH moved AS (
         DELETE FROM game_rounds gr
         WHERE gr.closed_at IS NOT NULL
           AND gr.issued_at < $1
           AND NOT EXISTS (
             SELECT 1 FROM game_history gh
             WHERE gh.user_id = gr.user_id
               AND gh.lyric_id = gr.lyric_id
               AND gh.created_at >= gr.issued_at
           )
         RETURNING gr.*
       )
       INSERT INTO game_rounds_archive
       SELECT * FROM moved`,
      [cutoff],
    );

    return Array.isArray(result) ? result.length : 0;
  }

  /**
   * Scores a guess against a round served to this player, and closes it.
   *
   * The round is closed with a conditional update before the answer is revealed,
   * so two concurrent guesses cannot both be scored and the answer the
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
      throw new DomainException(
        ErrorCode.ROUND_ALREADY_GUESSED,
        HttpStatus.CONFLICT,
        'This round has already been guessed',
      );
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
      throw new DomainException(
        ErrorCode.ROUND_EXPIRED,
        HttpStatus.GONE,
        'This round has expired',
      );
    }

    const closed = await this.roundRepository.update(
      { id: round.id, closedAt: IsNull() },
      { closedAt: now },
    );

    if (!closed.affected) {
      throw new DomainException(
        ErrorCode.ROUND_ALREADY_GUESSED,
        HttpStatus.CONFLICT,
        'This round has already been guessed',
      );
    }

    const result = await this.checkGuess({
      lyricId: round.lyricId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });

    const lyric = await this.lyricsRepository.findOne({ where: { id: round.lyricId } });
    const score = scoreRound({
      basePoints: result.points ?? 0,
      isCorrect: result.isCorrect,
      elapsedMs: now.getTime() - round.issuedAt.getTime(),
      windowMs: round.answerWindowSeconds * 1000,
      hintsUsed: round.hintsUsed,
      difficulty: lyric?.difficulty ?? 1,
    });

    await this.roundRepository.manager.transaction(async (manager) => {
      const closed = await manager.update(
        GameRound,
        { id: round.id, closedAt: IsNull() },
        { closedAt: now },
      );
      if (!closed.affected) {
        throw new ConflictException('This round has already been guessed');
      }
      if (lyric) {
        await recordReferralRound(manager, {
          roundId: round.id,
          userId,
          lyricId: round.lyricId,
          correctInTime: result.isCorrect && !score.timedOut,
          elapsedMs: now.getTime() - round.issuedAt.getTime(),
          snippet: lyric.lyricSnippet,
        });
      }
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
   * Reveals the next hint for an open round: the genre plus the
   * word counts, then the first letters, up to the configured maximum.
   *
   * Each hint lowers the maximum this round can still score; the reduction is
   * applied when the guess is scored, from `round.hintsUsed`.
   */
  async useHint(userId: string, roundId: string): Promise<RoundHints> {
    const round = await this.roundRepository.findOne({
      where: { id: roundId, userId },
    });

    if (!round) {
      throw new NotFoundException('Round not found');
    }

    if (round.closedAt) {
      throw new DomainException(
        ErrorCode.ROUND_ALREADY_GUESSED,
        HttpStatus.CONFLICT,
        'This round has already been guessed',
      );
    }

    if (round.expiresAt.getTime() <= Date.now()) {
      throw new DomainException(
        ErrorCode.ROUND_EXPIRED,
        HttpStatus.GONE,
        'This round has expired',
      );
    }

    const maxHints = GAME_CONSTANTS.LIMITS.MAX_HINTS_PER_ROUND;
    if (round.hintsUsed >= maxHints) {
      throw new ConflictException('No hints remaining for this round');
    }

    const level = round.hintsUsed + 1;
    const updated = await this.roundRepository.update(
      { id: round.id, closedAt: IsNull(), hintsUsed: round.hintsUsed },
      { hintsUsed: level },
    );

    if (!updated.affected) {
      throw new ConflictException('Hint already taken, please retry');
    }

    const lyric = await this.lyricsRepository.findOne({
      where: { id: round.lyricId },
    });

    if (!lyric) {
      throw new NotFoundException('Lyric not found');
    }

    const hints: RoundHints = {
      level,
      hintsRemaining: maxHints - level,
      maxPoints: maxRoundPoints(level),
    };

    if (level >= 1) {
      hints.genre = lyric.genre ?? null;
      hints.wordCount = {
        songTitle: countWords(lyric.songTitle),
        artist: countWords(lyric.artist),
      };
    }

    if (level >= 2) {
      hints.firstLetter = {
        songTitle: firstLetter(lyric.songTitle),
        artist: firstLetter(lyric.artist),
      };
    }

    return hints;
  }

  /** Alias kept for callers that still use the pre-R3 name. */
  async revealHint(userId: string, roundId: string): Promise<RoundHints> {
    return this.useHint(userId, roundId);
  }

  /**
   * Scores a guess against a lyric without any round bookkeeping. Used by
   * {@link guessRound}; exposed for callers that only need the comparison.
   */
  async checkGuess(dto: LyricGuessDto): Promise<GuessResult> {
    const lyric = await this.lyricsRepository.findOne({
      where: { id: dto.lyricId },
    });

    if (!lyric) {
      throw new NotFoundException('Lyric not found');
    }

    const correctAnswer =
      dto.guessType === 'artist' ? lyric.artist : lyric.songTitle;
    const { isCorrect, points } = matchGuess(dto.guessValue, correctAnswer);

    return {
      isCorrect,
      correctAnswer,
      explanation: isCorrect
        ? 'Correct!'
        : `The correct answer was "${correctAnswer}".`,
      points,
    };
  }

  /**
   * Validates a guess against a round without closing it. Returns the same
   * shape as {@link guessRound} but performs no scoring or state change.
   */
  async validateGuess(
    userId: string,
    dto: RoundGuessDto,
  ): Promise<GuessResult> {
    const round = await this.roundRepository.findOne({
      where: { id: dto.roundId, userId },
    });

    if (!round) {
      throw new NotFoundException('Round not found');
    }

    return this.checkGuess({
      lyricId: round.lyricId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });
  }

  /**
   * Issues rounds for several lyrics at once, in order. Used when a session
   * starts and every player needs their first lyric.
   */
  async issueRounds(
    userId: string,
    lyricIds: number[],
    sessionId?: string,
  ): Promise<GameRound[]> {
    if (!lyricIds.length) {
      throw new BadRequestException('At least one lyric is required');
    }

    const rounds: GameRound[] = [];
    for (const lyricId of lyricIds) {
      rounds.push(await this.issueRound(userId, lyricId, sessionId));
    }
    return rounds;
  }

  /**
   * Picks a random lyric for a player, honouring the category, decade, genre
   * and difficulty filters and excluding lyrics the player has seen recently.
   */
  async getRandomLyric(
    options: RandomLyricOptions = {},
  ): Promise<GameLyric> {
    const lyric = await this.pickRandomLyric(options);
    if (!lyric) {
      throw new NotFoundException('No lyrics available for these filters');
    }
    return toGameLyric(lyric);
  }

  /** Picks `count` distinct random lyrics for a player. */
  async getMultipleRandomLyrics(
    count: number,
    options: RandomLyricOptions = {},
  ): Promise<GameLyric[]> {
    if (count <= 0) {
      throw new BadRequestException('count must be greater than zero');
    }

    const picked: GameLyric[] = [];
    const excludeIds = new Set(options.excludeIds ?? []);

    for (let i = 0; i < count; i += 1) {
      const lyric = await this.pickRandomLyric({
        ...options,
        excludeIds: [...excludeIds],
      });

      if (!lyric) {
        break;
      }

      excludeIds.add(lyric.id);
      picked.push(toGameLyric(lyric));
    }

    if (!picked.length) {
      throw new NotFoundException('No lyrics available for these filters');
    }

    return picked;
  }

  /** Aggregate counts used by the challenges and stats screens. */
  async getLyricStats(): Promise<{
    total: number;
    byGenre: Record<string, number>;
    byDecade: Record<string, number>;
  }> {
    const total = await this.lyricsRepository.count();

    const genreRows: Array<{ genre: string | null; count: string }> =
      await this.lyricsRepository
        .createQueryBuilder('lyric')
        .select('lyric.genre', 'genre')
        .addSelect('COUNT(*)', 'count')
        .groupBy('lyric.genre')
        .getRawMany();

    const decadeRows: Array<{ decade: string | null; count: string }> =
      await this.lyricsRepository
        .createQueryBuilder('lyric')
        .select('lyric.decade', 'decade')
        .addSelect('COUNT(*)', 'count')
        .groupBy('lyric.decade')
        .getRawMany();

    const byGenre: Record<string, number> = {};
    for (const row of genreRows) {
      if (row.genre) {
        byGenre[row.genre] = Number(row.count);
      }
    }

    const byDecade: Record<string, number> = {};
    for (const row of decadeRows) {
      if (row.decade) {
        byDecade[row.decade] = Number(row.count);
      }
    }

    return { total, byGenre, byDecade };
  }

  /** Builds the filtered query used by the random-lyric pickers. */
  private buildLyricQuery(
    options: RandomLyricOptions,
  ): SelectQueryBuilder<Lyrics> {
    const qb = this.lyricsRepository.createQueryBuilder('lyric');

    if (options.category) {
      qb.andWhere('lyric.category = :category', {
        category: options.category,
      });
    }

    if (options.decade) {
      qb.andWhere('lyric.decade = :decade', { decade: options.decade });
    }

    const genre = this.resolveGenre(options);
    if (genre) {
      qb.andWhere('lyric.genre = :genre', { genre });
    }

    if (options.difficulty !== undefined) {
      qb.andWhere('lyric.difficulty = :difficulty', {
        difficulty: options.difficulty,
      });
    }

    if (options.excludeIds?.length) {
      qb.andWhere('lyric.id NOT IN (:...excludeIds)', {
        excludeIds: options.excludeIds,
      });
    }

    return qb;
  }

  /** Resolves the genre filter, applying the player's preference if allowed. */
  private resolveGenre(options: RandomLyricOptions): string | undefined {
    if (options.genre) {
      return isGenre(options.genre) ? toGenre(options.genre) : undefined;
    }

    if (options.ignorePreferences || !options.preferredGenre) {
      return undefined;
    }

    return isGenre(options.preferredGenre)
      ? toGenre(options.preferredGenre)
      : undefined;
  }

  /** Picks one random lyric, excluding those the player has seen recently. */
  private async pickRandomLyric(
    options: RandomLyricOptions,
  ): Promise<Lyrics | null> {
    const qb = this.buildLyricQuery(options);

    if (options.userId) {
      const windowDays = options.seenWindowDays ?? this.seenWindowDays;
      const cutoff = new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000,
      );
      qb.andWhere(
        `lyric.id NOT IN (
           SELECT gr.lyric_id FROM game_rounds gr
           WHERE gr.user_id = :seenUserId AND gr.issued_at >= :seenCutoff
         )`,
        { seenUserId: options.userId, seenCutoff: cutoff },
      );
    }

    qb.orderBy('RANDOM()').limit(1);
    return (await qb.getOne()) ?? null;
  }

  /**
   * Ensures the player is an active participant of the session, throwing when
   * the session is missing, finished, or the player is not in it.
   */
  async assertActiveParticipant(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
      throw new ConflictException('This session is no longer active');
    }

    const participants = await this.sessionRepository.manager
      .createQueryBuilder()
      .select('1')
      .from('game_session_players', 'p')
      .where('p.session_id = :sessionId', { sessionId })
      .andWhere('p.user_id = :userId', { userId })
      .getRawOne();

    if (!participants) {
      throw new ConflictException('You are not a participant of this session');
    }
  }

  /** Bumps the session's last-activity timestamp. */
  async touchSession(sessionId: string): Promise<void> {
    await this.sessionRepository.update(
      { id: sessionId },
      { lastActivityAt: new Date() },
    );
  }

  /** Emits the round-ended realtime event for a closed round. */
  private emitRoundEnded(
    round: GameRound,
    outcome: {
      isCorrect: boolean;
      points: number;
      speedBonus: number;
      timedOut: boolean;
    },
  ): void {
    const payload: RoundEndedPayload = {
      roundId: round.id,
      sessionId: round.sessionId ?? null,
      userId: round.userId,
      lyricId: round.lyricId,
      isCorrect: outcome.isCorrect,
      points: outcome.points,
      speedBonus: outcome.speedBonus,
      timedOut: outcome.timedOut,
      hintsUsed: round.hintsUsed,
      closedAt: new Date(),
    };
    this.events.emit(RealtimeEvent.ROUND_ENDED, payload);
  }
}

/** Counts the words in a title or artist name. */
function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** First letter of a title or artist name, upper-cased. */
function firstLetter(value: string): string {
  return value.trim().charAt(0).toUpperCase();
}

/** Maps a lyric entity onto the public {@link GameLyric} shape. */
function toGameLyric(lyric: Lyrics): GameLyric {
  return {
    id: lyric.id,
    lyricSnippet: lyric.lyricSnippet,
    songTitle: lyric.songTitle,
    artist: lyric.artist,
    category: lyric.category ?? undefined,
    decade: lyric.decade ?? undefined,
    genre: lyric.genre ?? undefined,
  };
}
