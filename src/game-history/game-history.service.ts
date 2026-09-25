import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { GameHistory } from './entities/game-history.entity';
import { CreateGameHistoryDto } from './dto/create-game-history.dto';
import { GameHistoryQueryDto } from './dto/game-history-query.dto';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';

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
  ) { }

  /**
   * Creates a new game history record
   */
  async create(createGameHistoryDto: CreateGameHistoryDto): Promise<GameHistory> {
    this.logger.debug(`Creating game history for player ${createGameHistoryDto.playerId}`);

    try {
      const gameHistory = this.gameHistoryRepository.create(createGameHistoryDto);
      const savedHistory = await this.gameHistoryRepository.save(gameHistory);

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

      const data: GameHistoryResponse[] = histories.map((history) => ({
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
      }));

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
   * Gets user statistics from their game history
   */
  async getUserStats(userId: string): Promise<{
    totalGames: number;
    correctGuesses: number;
    incorrectGuesses: number;
    accuracy: number;
    totalPointsEarned: number;
    totalXpGained: number;
    bestStreak: number;
    averagePointsPerGame: number;
  }> {
    this.logger.debug(`Calculating stats for user ${userId}`);

    try {
      const histories = await this.gameHistoryRepository.find({
        where: { playerId: userId },
        order: { createdAt: 'ASC' },
      });

      if (histories.length === 0) {
        return {
          totalGames: 0,
          correctGuesses: 0,
          incorrectGuesses: 0,
          accuracy: 0,
          totalPointsEarned: 0,
          totalXpGained: 0,
          bestStreak: 0,
          averagePointsPerGame: 0,
        };
      }

      const totalGames = histories.length;
      const correctGuesses = histories.filter(h => h.isCorrect).length;
      const incorrectGuesses = totalGames - correctGuesses;
      const accuracy = totalGames > 0 ? (correctGuesses / totalGames) * 100 : 0;
      const totalPointsEarned = histories.reduce((sum, h) => sum + h.pointsAwarded, 0);
      const totalXpGained = histories.reduce((sum, h) => sum + h.xpChange, 0);

      // Calculate best streak
      let currentStreak = 0;
      let bestStreak = 0;

      for (const history of histories) {
        if (history.isCorrect) {
          currentStreak++;
          bestStreak = Math.max(bestStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      }

      const averagePointsPerGame = totalGames > 0 ? totalPointsEarned / totalGames : 0;

      return {
        totalGames,
        correctGuesses,
        incorrectGuesses,
        accuracy: Math.round(accuracy * 100) / 100, // Round to 2 decimal places
        totalPointsEarned,
        totalXpGained,
        bestStreak,
        averagePointsPerGame: Math.round(averagePointsPerGame * 100) / 100,
      };
    } catch (error) {
      this.logger.error('Error calculating user stats:', error.stack);
      throw error;
    }
  }

  /**
   * Finds a specific game history record by ID
   */
  async findOne(id: string): Promise<GameHistory> {
    const history = await this.gameHistoryRepository.findOne({
      where: { id },
      relations: ['lyric', 'gameSession', 'player'],
    });

    if (!history) {
      throw new NotFoundException(`Game history with ID ${id} not found`);
    }

    return history;
  }
}
