import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GameLogicService } from '../game/game.service';
import { GAME_CONSTANTS } from '../game/constants/game.constants';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { User } from '../users/entities/user.entity';
import { XpLevelService } from '../xp-level/xp-level.service';
import { ChallengeCompletedNotificationPayload } from '../notifications/interfaces/notification.interface';
import { DailyChallenge } from './entities/daily-challenge.entity';
import { DailyChallengeAttempt } from './entities/daily-challenge-attempt.entity';
import { DailyGuessDto } from './dto/daily-guess.dto';
import { pickDeterministic, utcDay } from './daily-seed.util';

const UNIQUE_VIOLATION = '23505';
const LEADERBOARD_SIZE = 50;

/**
 * Server secret mixed into the daily seed so future sets cannot be computed
 * from the public lyric ids alone. Falls back to a per-process random value
 * when unset, which still prevents offline prediction.
 */
const DAILY_CHALLENGE_SALT =
  process.env.DAILY_CHALLENGE_SALT ??
  `fallback-${Math.random().toString(36).slice(2)}`;

export interface DailyLyric {
  id: number;
  lyricSnippet: string;
  category?: string;
  decade?: string;
  genre?: string;
  /** Present once the caller has used their attempt on this lyric. */
  attempt?: { isCorrect: boolean; points: number };
}

export interface DailyChallengeView {
  date: string;
  lyrics: DailyLyric[];
  attempted: number;
  total: number;
}

export interface DailyGuessResult {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  points: number;
  completed: boolean;
}

export interface DailyLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  points: number;
  correct: number;
}

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  /** The current day's lyric ids, so the day's set is read from the DB once. */
  private cached?: { date: string; lyricIds: number[] };

  constructor(
    @InjectRepository(DailyChallenge)
    private readonly challengeRepository: Repository<DailyChallenge>,
    @InjectRepository(DailyChallengeAttempt)
    private readonly attemptRepository: Repository<DailyChallengeAttempt>,
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    private readonly gameService: GameLogicService,
    private readonly xpService: XpLevelService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * The lyric ids for a UTC day. Chosen with a salted, date-seeded shuffle of
   * the active lyrics, so every instance picks the same ones but the set
   * cannot be computed without the server secret, and stored so they stay
   * fixed for the day whatever happens to the lyrics table.
   */
  async getDailyLyricIds(date: string = utcDay()): Promise<number[]> {
    if (this.cached?.date === date) return this.cached.lyricIds;

    let challenge = await this.challengeRepository.findOne({ where: { date } });

    if (!challenge) {
      const pool = await this.lyricsRepository.find({
        where: { isActive: true },
        select: ['id'],
      });

      if (pool.length === 0) {
        throw new NotFoundException(
          'No lyrics available for a daily challenge',
        );
      }

      const lyricIds = pickDeterministic(
        pool.map((lyric) => lyric.id),
        GAME_CONSTANTS.LIMITS.DAILY_CHALLENGE_SIZE,
        `${date}:${DAILY_CHALLENGE_SALT}`,
      );

      // A concurrent request may have stored the day's set first; ignore the
      // conflict and read back whichever row won.
      await this.challengeRepository
        .createQueryBuilder()
        .insert()
        .values({ date, lyricIds })
        .orIgnore()
        .execute();

      challenge = await this.challengeRepository.findOneOrFail({
        where: { date },
      });
    }

    this.cached = { date, lyricIds: challenge.lyricIds };
    return challenge.lyricIds;
  }

  /**
   * The subset of the day's fixed lyric ids that are still active (playable).
   *
   * The day's set stays fixed in `daily_challenges.lyricIds`, but if an admin
   * deactivates one of those lyrics mid-day it can no longer be guessed
   * (`checkGuess` only loads active lyrics). To keep the challenge completable
   * and `total` consistent with what is actually playable, both `total` and the
   * completion check are computed from the still-active ids only. The lyric is
   * simply excluded from today's playable set; tomorrow's draw is unaffected.
   */
  private async getActiveDailyLyricIds(
    lyricIds: number[],
  ): Promise<number[]> {
    if (lyricIds.length === 0) return [];

    const active = await this.lyricsRepository.find({
      where: { id: In(lyricIds), isActive: true },
      select: ['id'],
    });
    const activeSet = new Set(active.map((lyric) => lyric.id));

    return lyricIds.filter((id) => activeSet.has(id));
  }

  /** Today's lyrics (never their answers) and the caller's progress on them. */
  async getDaily(userId: string): Promise<DailyChallengeView> {
    const date = utcDay();
    const lyricIds = await this.getDailyLyricIds(date);

    const [lyrics, attempts] = await Promise.all([
      this.lyricsRepository.find({
        where: { id: In(lyricIds), isActive: true },
      }),
      this.attemptRepository.find({ where: { userId, challengeDate: date } }),
    ]);

    const byId = new Map(lyrics.map((lyric) => [lyric.id, lyric]));
    const attemptByLyric = new Map(attempts.map((a) => [a.lyricId, a]));

    const view: DailyLyric[] = lyricIds
      .filter((id) => byId.has(id))
      .map((id) => {
        const lyric = byId.get(id)!;
        const attempt = attemptByLyric.get(id);

        return {
          id,
          lyricSnippet: lyric.lyricSnippet,
          category: lyric.category,
          decade: lyric.decade,
          genre: lyric.genre,
          ...(attempt && {
            attempt: { isCorrect: attempt.isCorrect, points: attempt.points },
          }),
        };
      });

    return {
      date,
      lyrics: view,
      attempted: attempts.length,
      // `total` reflects the playable lyrics only, so it matches the view and
      // stays completable even if a lyric was deactivated mid-day.
      total: view.length,
    };
  }

  /**
   * Scores the caller's single attempt at one of today's lyrics.
   *
   * The attempt is recorded before the answer is revealed, and a unique
   * constraint on (user, day, lyric) decides races, so two simultaneous
   * requests cannot both score. Answers submitted after the answer window
   * score 0.
   */
  async guess(userId: string, dto: DailyGuessDto): Promise<DailyGuessResult> {
    const date = utcDay();
    const lyricIds = await this.getDailyLyricIds(date);

    if (!lyricIds.includes(dto.lyricId)) {
      throw new NotFoundException(
        "That lyric is not part of today's challenge",
      );
    }

    const validation = this.gameService.validateGuess(dto.guessValue);
    if (!validation.isValid) {
      throw new BadRequestException(validation.reason);
    }

    const result = await this.gameService.checkGuess({
      lyricId: dto.lyricId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });

    // Enforce the same answer window as solo play: a guess submitted after the
    // window has elapsed scores 0 regardless of correctness.
    const withinWindow = this.isWithinAnswerWindow(dto);
    const points = withinWindow ? result.points ?? 0 : 0;

    try {
      await this.attemptRepository.insert({
        userId,
        challengeDate: date,
        lyricId: dto.lyricId,
        guessType: dto.guessType,
        isCorrect: result.isCorrect,
        points,
      });
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'You have already attempted this lyric today',
        );
      }
      throw error;
    }

    if (result.isCorrect && withinWindow) {
      await this.xpService.handleCorrectGuess(userId);
    }

    const [attempts, activeLyricIds] = await Promise.all([
      this.attemptRepository.find({
        where: { userId, challengeDate: date },
      }),
      this.getActiveDailyLyricIds(lyricIds),
    ]);
    // Completion only requires attempts on the still-active lyrics, so a lyric
    // deactivated mid-day cannot make the challenge impossible to complete.
    const completed =
      activeLyricIds.length > 0 &&
      activeLyricIds.every((id) =>
        attempts.some((attempt) => attempt.lyricId === id),
      );

    if (completed) {
      this.announceCompletion(userId, date, attempts);
    }

    return {
      isCorrect: result.isCorrect,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation ?? '',
      points,
      completed,
    };
  }

  /**
   * Whether the guess was submitted within the answer window. The window is
   * measured from the round's issued timestamp when the client supplies one;
   * otherwise the guess is treated as in-window (legacy clients).
   */
  private isWithinAnswerWindow(dto: DailyGuessDto): boolean {
    const issuedAt = (dto as { issuedAt?: string | number }).issuedAt;
    if (issuedAt === undefined || issuedAt === null) return true;

    const issuedMs =
      typeof issuedAt === 'number' ? issuedAt : Date.parse(issuedAt);
    if (Number.isNaN(issuedMs)) return true;

    const elapsed = Date.now() - issuedMs;
    return elapsed <= GAME_CONSTANTS.LIMITS.ANSWER_WINDOW_MS;
  }

  /** Today's (or another day's) ranking by points, then correct answers. */
  async getLeaderboard(
    date: string = utcDay(),
  ): Promise<DailyLeaderboardEntry[]> {
    const rows = await this.attemptRepository
      .createQueryBuilder('attempt')
      .innerJoin(User, 'player', 'player.id = attempt.userId')
      .select('attempt.userId', 'userId')
      .addSelect('player.username', 'username')
      .addSelect('SUM(attempt.points)', 'points')
      .addSelect(
        'SUM(CASE WHEN attempt.isCorrect THEN 1 ELSE 0 END)',
        'correct',
      )
      .where('attempt.challengeDate = :date', { date })
      .groupBy('attempt.userId')
      .addGroupBy('player.username')
      .orderBy('points', 'DESC')
      .addOrderBy('correct', 'DESC')
      .addOrderBy('player.username', 'ASC')
      .limit(LEADERBOARD_SIZE)
      .getRawMany<{
        userId: string;
        username: string;
        points: string;
        correct: string;
      }>();

    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: row.username,
      points: Number(row.points),
      correct: Number(row.correct),
    }));
  }

  private announceCompletion(
    userId: string,
    date: string,
    attempts: DailyChallengeAttempt[],
  ): void {
    const points = attempts.reduce((sum, attempt) => sum + attempt.points, 0);
    const correct = attempts.filter((attempt) => attempt.isCorrect).length;

    const payload: ChallengeCompletedNotificationPayload = {
      userId,
      challengeDate: date,
      points,
      correct,
      total: attempts.length,
    };

    this.events.emit('user.completed_challenge', payload);
  }
}
