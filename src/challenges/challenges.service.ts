import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GameLogicService } from '../game/game.service';
import { GAME_CONSTANTS } from '../game/constants/game.constants';
import { GameRound } from '../game/entities/game-round.entity';
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

export interface DailyLyric {
  /** The server-issued round id the client must pass back when guessing. */
  roundId: string;
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
    @InjectRepository(GameRound)
    private readonly roundRepository: Repository<GameRound>,
    private readonly gameService: GameLogicService,
    private readonly xpService: XpLevelService,
    private readonly events: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Server secret mixed into the daily seed so future sets cannot be predicted
   * from the public lyric ids alone. Required in production; a short default
   * is used in development/test so the app starts without configuration.
   */
  private get dailyChallengeSalt(): string {
    const salt = this.configService.get<string>('DAILY_CHALLENGE_SALT');
    if (!salt) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        // env.validation.ts already rejects this at boot, but guard again.
        throw new InternalServerErrorException(
          'DAILY_CHALLENGE_SALT must be set in production',
        );
      }
      return 'dev-salt';
    }
    return salt;
  }

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
        `${date}:${this.dailyChallengeSalt}`,
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
   * Ensures one `game_round` row exists for each of the caller's daily lyrics
   * and returns them, keyed by lyric id.
   *
   * Rounds are issued once per user per lyric per day and reused on subsequent
   * calls. The `issuedAt` timestamp on the row is what the answer window is
   * measured against when the guess arrives — no client-supplied timestamp is
   * ever trusted.
   *
   * Re-issuing open rounds (closedAt IS NULL) would reset the timer without
   * giving points, so only the first open round per lyric is kept. A race
   * between two simultaneous GET requests is resolved by the unique constraint
   * on (userId, dailyDate, lyricId): whichever insert wins is used.
   */
  private async getOrIssueRounds(
    userId: string,
    date: string,
    lyricIds: number[],
  ): Promise<Map<number, GameRound>> {
    if (lyricIds.length === 0) return new Map();

    // Load any rounds already issued for today (open or closed).
    const existing = await this.roundRepository.find({
      where: { userId, dailyDate: date, lyricId: In(lyricIds) },
    });
    const byLyric = new Map(existing.map((r) => [r.lyricId, r]));

    // Issue rounds for lyrics that do not have one yet.
    const missing = lyricIds.filter((id) => !byLyric.has(id));
    for (const lyricId of missing) {
      try {
        const issued = await this.gameService.issueRound(userId, lyricId, undefined, date);
        byLyric.set(lyricId, issued);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === UNIQUE_VIOLATION) {
          // A concurrent request won the race; load the round it created.
          const existing = await this.roundRepository.findOne({
            where: { userId, dailyDate: date, lyricId },
          });
          if (existing) {
            byLyric.set(lyricId, existing);
          }
        } else {
          throw err;
        }
      }
    }

    return byLyric;
  }

  /**
   * The subset of the day's fixed lyric ids that are still active (playable).
   *
   * The day's set stays fixed in `daily_challenges.lyricIds`, but if an admin
   * deactivates one of those lyrics mid-day it can no longer be guessed.
   * To keep the challenge completable both `total` and the completion check
   * are computed from the still-active ids only.
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

  /**
   * Today's lyrics (never their answers), each paired with a server-issued
   * round id the client must present when guessing, and the caller's progress.
   */
  async getDaily(userId: string): Promise<DailyChallengeView> {
    const date = utcDay();
    const lyricIds = await this.getDailyLyricIds(date);

    const [lyrics, attempts, roundsByLyric] = await Promise.all([
      this.lyricsRepository.find({
        where: { id: In(lyricIds), isActive: true },
      }),
      this.attemptRepository.find({ where: { userId, challengeDate: date } }),
      this.getOrIssueRounds(userId, date, lyricIds),
    ]);

    const byId = new Map(lyrics.map((lyric) => [lyric.id, lyric]));
    const attemptByLyric = new Map(attempts.map((a) => [a.lyricId, a]));

    const view: DailyLyric[] = lyricIds
      .filter((id) => byId.has(id) && roundsByLyric.has(id))
      .map((id) => {
        const lyric = byId.get(id)!;
        const round = roundsByLyric.get(id)!;
        const attempt = attemptByLyric.get(id);

        return {
          roundId: round.id,
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
      total: view.length,
    };
  }

  /**
   * Scores the caller's single attempt at one of today's lyrics.
   *
   * The guess is routed through `GameLogicService.guessRound`, which closes
   * the round with a conditional UPDATE before scoring it. The answer window
   * is measured against `game_rounds.issuedAt` — a server-set timestamp — so
   * no client-supplied value is used. A guess after the window scores 0.
   */
  async guess(userId: string, dto: DailyGuessDto): Promise<DailyGuessResult> {
    const date = utcDay();
    const lyricIds = await this.getDailyLyricIds(date);

    // Verify the round belongs to the caller and is for today's challenge.
    const round = await this.roundRepository.findOne({
      where: { id: dto.roundId, userId, dailyDate: date },
    });

    if (!round) {
      throw new NotFoundException(
        "Round not found, or it does not belong to today's challenge",
      );
    }

    if (!lyricIds.includes(round.lyricId)) {
      throw new NotFoundException(
        "That lyric is not part of today's challenge",
      );
    }

    // Delegate scoring and window enforcement entirely to the game service.
    // guessRound measures elapsed time against game_rounds.issuedAt, which was
    // set by the server when the round was issued — the client cannot influence
    // the timer.
    const result = await this.gameService.guessRound(userId, {
      roundId: dto.roundId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });

    const points = result.points ?? 0;

    try {
      await this.attemptRepository.insert({
        userId,
        challengeDate: date,
        lyricId: round.lyricId,
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

    if (result.isCorrect && !result.timedOut) {
      await this.xpService.handleCorrectGuess(userId);
    }

    const [attempts, activeLyricIds] = await Promise.all([
      this.attemptRepository.find({
        where: { userId, challengeDate: date },
      }),
      this.getActiveDailyLyricIds(lyricIds),
    ]);

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
    const correct = attempts.filter((attempt) => attempt.isCorrect).length;

    const payload: ChallengeCompletedNotificationPayload = {
      userId,
      challengeName: `daily-${date}`,
      streakCount: correct,
      timestamp: new Date(),
      message: `You completed the daily challenge for ${date}!`,
    };

    this.events.emit('user.completed_challenge', payload);
    this.events.emit('challenge.completed', payload);
  }
}
