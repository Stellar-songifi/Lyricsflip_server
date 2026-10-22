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
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { matchGuess, normalizeAnswer } from './guess-matcher';
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

/**
 * Name of the advisory lock guarding the daily `game_rounds` retention job.
 * The lock is taken with `pg_try_advisory_lock` so only one instance runs the
 * job at a time (see issue 43).
 */
const GAME_ROUNDS_RETENTION_LOCK = 330_075;

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
   * Daily retention job for `game_rounds`.
   *
   * - Unguessed rounds older than the seen window are deleted: they no longer
   *   affect the seen-window query and were never scored.
   * - Guessed rounds older than `roundRetentionDays` are deleted once
   *   `game_history` holds the record; otherwise they are moved into the
   *   `game_rounds_archive` table.
   *
   * A Postgres advisory lock ensures only one instance runs the job at a time.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneGameRounds(): Promise<void> {
    const acquired = await this.tryAcquireRetentionLock();
    if (!acquired) {
      this.logger.debug('game_rounds retention job already running elsewhere');
      return;
    }

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
      this.logger.error('game_rounds retention job failed', error as Error);
    } finally {
      await this.releaseRetentionLock();
    }
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

  private async tryAcquireRetentionLock(): Promise<boolean> {
    const rows: Array<{ locked: boolean }> =
      await this.roundRepository.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [GAME_ROUNDS_RETENTION_LOCK],
      );
    return rows[0]?.locked === true;
  }

  private async releaseRetentionLock(): Promise<void> {
    await this.roundRepository.query(
      'SELECT pg_advisory_unlock($1)',
      [GAME_ROUNDS_RETENTION_LOCK],
    );
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
   * Reveals the next hint for an open round: the genre plus the

/* … truncated 6620 chars — edit only what you need near the top … */
