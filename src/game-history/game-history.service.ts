import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { GameHistory } from './entities/game-history.entity';
import { CreateGameHistoryDto } from './dto/create-game-history.dto';
import { GameHistoryQueryDto } from './dto/game-history-query.dto';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';
import { User } from '../users/entities/user.entity';
import { Role } from '../auth/roles/role.enum';

export interface GameHistoryResponse {
  id: string;
  lyricId: number;
  guessType: string;
  guessValue: string;
  isCorrect: boolean;
  pointsAwarded: number;
  xpChange: number;
  wagerAmount?: number;
  createdAt: Date;
  lyric?: {
    artist: string;
    songTitle: string;
    lyricSnippet: string;
  };
  gameSession?: {
    id: string;
    mode: string;
    category: string;
  };
}

export interface UserStats {
  totalGames: number;
  correctGuesses: number;
  incorrectGuesses: number;
  accuracy: number;
  totalPointsEarned: number;
  totalXpGained: number;
  bestStreak: number;
  averagePointsPerGame: number;
}

/** Stats are cached briefly per user and dropped when a guess is recorded. */
const USER_STATS_CACHE_TTL_MS = 30_000;
const userStatsCacheKey = (userId: string) => `game-history:stats:${userId}`;

/**
 * Every stat in one round trip, however long the history is.
 *
 * Best streak is gaps-and-islands: within a run of equal isCorrect values,
 * (row number over all guesses) - (row number within that isCorrect value)
 * is constant, so grouping correct guesses by that difference yields one
 * group per streak. Ties on createdAt are broken by id, so the order is
 * stable.
 */
const USER_STATS_SQL = `
  WITH ordered AS (
    SELECT "isCorrect", "pointsAwarded", "xpChange",
           ROW_NUMBER() OVER (ORDER BY "createdAt", "id")
             - ROW_NUMBER() OVER (PARTITION BY "isCorrect" ORDER BY "createdAt", "id") AS run
      FROM "game_history"
     WHERE "playerId" = $1
  ),
  streaks AS (
    SELECT COUNT(*) AS length FROM ordered WHERE "isCorrect" GROUP BY run
  )
  SELECT COUNT(*)                                  AS "totalGames",
         COUNT(*) FILTER (WHERE "isCorrect")       AS "correctGuesses",
         COALESCE(SUM("pointsAwarded"), 0)         AS "totalPointsEarned",
         COALESCE(SUM("xpChange"), 0)              AS "totalXpGained",
         (SELECT COALESCE(MAX(length), 0) FROM streaks) AS "bestStreak"
    FROM ordered
`;

export interface PaginatedGameHistoryResponse {
  data: GameHistoryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class GameHistoryService {
  private readonly logger = new Logger(GameHistoryService.name);

  constructor(
    @InjectRepository(GameHistory)
    private gameHistoryRepository: Repository<GameHistory>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) { }

  /**
   * Creates a new game history record
   */
  async create(createGameHistoryDto: CreateGameHistoryDto): Promise<GameHistory> {
    this.logger.debug(`Creating game history for player ${createGameHistoryDto.playerId}`);

    try {
      const gameHistory = this.gameHistoryRepository.create(createGameHistoryDto);
      const savedHistory = await this.gameHistoryRepository.save(gameHistory);
      await this.cacheManager.del(userStatsCacheKey(savedHistory.playerId));

      this.logger.debug(`Game history created with ID: ${savedHistory.id}`);
      return savedHistory;
    } catch (error) {
      this.logger.error('Error creating game history:', error.stack);
      throw error;
    }
  }

  /**
   * Retrieves paginated game history for a specific user
   */
  async findByUserId(
    userId: string,
    queryDto: GameHistoryQueryDto,
  ): Promise<PaginatedGameHistoryResponse> {
    this.logger.debug(`Fetching game history for user ${userId}`);

    // Bounds are validated by GameHistoryQueryDto; the cap is a backstop
    const page = queryDto.page ?? 1;
    const limit = Math.min(queryDto.limit ?? 10, MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    // Build where conditions
    const whereConditions: any = { playerId: userId };

    if (queryDto.guessType) {
      whereConditions.guessType = queryDto.guessType;
    }

    if (queryDto.isCorrect !== undefined) {
      whereConditions.isCorrect = queryDto.isCorrect;
    }

    if (queryDto.lyricId) {
      whereConditions.lyricId = parseInt(queryDto.lyricId, 10);
    }

    if (queryDto.startDate && queryDto.endDate) {
      whereConditions.createdAt = Between(
        new Date(queryDto.startDate),
        new Date(queryDto.endDate),
      );
    } else if (queryDto.startDate) {
      whereConditions.createdAt = Between(
        new Date(queryDto.startDate),
        new Date(),
      );
    }

    try {
      const [histories, total] = await this.gameHistoryRepository.findAndCount({
        where: whereConditions,
        relations: ['lyric', 'gameSession'],
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });

      const data = histories.map((history) => this.toResponse(history));

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error fetching game history:', error.stack);
      throw error;
    }
  }

  /**
   * Gets user statistics from their game history: one aggregate query
   * (USER_STATS_SQL), cached per user for USER_STATS_CACHE_TTL_MS.
   */
  async getUserStats(userId: string): Promise<UserStats> {
    const cacheKey = userStatsCacheKey(userId);
    const cached = await this.cacheManager.get<UserStats>(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.debug(`Calculating stats for user ${userId}`);

    try {
      const [row] = await this.gameHistoryRepository.query(USER_STATS_SQL, [
        userId,
      ]);

      // COUNT and SUM come back from Postgres as strings (bigint/numeric).
      const totalGames = Number(row?.totalGames ?? 0);
      const correctGuesses = Number(row?.correctGuesses ?? 0);
      const totalPointsEarned = Number(row?.totalPointsEarned ?? 0);
      const accuracy = totalGames > 0 ? (correctGuesses / totalGames) * 100 : 0;
      const averagePointsPerGame =
        totalGames > 0 ? totalPointsEarned / totalGames : 0;

      const stats: UserStats = {
        totalGames,
        correctGuesses,
        incorrectGuesses: totalGames - correctGuesses,
        accuracy: Math.round(accuracy * 100) / 100, // Round to 2 decimal places
        totalPointsEarned,
        totalXpGained: Number(row?.totalXpGained ?? 0),
        bestStreak: Number(row?.bestStreak ?? 0),
        averagePointsPerGame: Math.round(averagePointsPerGame * 100) / 100,
      };

      await this.cacheManager.set(cacheKey, stats, USER_STATS_CACHE_TTL_MS);
      return stats;
    } catch (error) {
      this.logger.error('Error calculating user stats:', error.stack);
      throw error;
    }
  }

  /**
   * Finds a specific game history record by ID. Only its player, or an
   * admin, may read it.
   */
  async findOne(id: string, user: User): Promise<GameHistoryResponse> {
    const history = await this.gameHistoryRepository.findOne({
      where: { id },
      relations: ['lyric', 'gameSession'],
    });

    if (!history) {
      throw new NotFoundException(`Game history with ID ${id} not found`);
    }

    if (history.playerId !== user.id && user.role !== Role.Admin) {
      throw new ForbiddenException('You can only view your own game history');
    }

    return this.toResponse(history);
  }

  /**
   * Projects a record for the API. Relations are copied field by field so
   * that no entity, and in particular no user (the lyric's eager `createdBy`
   * carries a password hash), is ever serialised whole.
   */
  private toResponse(history: GameHistory): GameHistoryResponse {
    return {
      id: history.id,
      lyricId: history.lyricId,
      guessType: history.guessType,
      guessValue: history.guessValue,
      isCorrect: history.isCorrect,
      pointsAwarded: history.pointsAwarded,
      xpChange: history.xpChange,
      wagerAmount: history.wagerAmount,
      createdAt: history.createdAt,
      lyric: history.lyric ? {
        artist: history.lyric.artist,
        songTitle: history.lyric.songTitle,
        lyricSnippet: history.lyric.lyricSnippet,
      } : undefined,
      gameSession: history.gameSession ? {
        id: history.gameSession.id,
        mode: history.gameSession.mode,
        category: history.gameSession.category,
      } : undefined,
    };
  }
}
