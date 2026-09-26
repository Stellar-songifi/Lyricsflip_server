import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { Repository } from 'typeorm';
import { matchGuess, normalizeAnswer } from './guess-matcher';
import { Genre, isGenre, toGenre } from 'src/lyrics/entities/genre.enum';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { GameRound } from './entities/game-round.entity';
import { GAME_CONSTANTS } from './constants/game.constants';

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

@Injectable()
export class GameLogicService {
  private readonly logger = new Logger(GameLogicService.name);

  constructor(
    @InjectRepository(Lyrics)
    private lyricsRepository: Repository<Lyrics>,
    @InjectRepository(GameRound)
    private roundRepository: Repository<GameRound>,
  ) {}

  /**
   * Records that a lyric has been served to a player, opening the one round
   * that player can guess it in.
   */
  async issueRound(userId: string, lyricId: number): Promise<GameRound> {
    const expiresAt = new Date(
      Date.now() + GAME_CONSTANTS.LIMITS.ROUND_TIMEOUT_SECONDS * 1000,
    );

    return this.roundRepository.save(
      this.roundRepository.create({
        userId,
        lyricId,
        expiresAt,
        closedAt: null,
      }),
    );
  }

  /**
   * Scores a guess against a round served to this player, and closes it.
   *
   * The round is closed with a conditional update before the answer is looked
   * at, so two concurrent guesses cannot both be scored and the answer the
   * first one reveals cannot be replayed.
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
      throw new GoneException('This round has expired');
    }

    const closed = await this.roundRepository.update(
      { id: round.id, closedAt: IsNull() },
      { closedAt: now },
    );

    if (!closed.affected) {
      throw new ConflictException('This round has already been guessed');
    }

    return this.checkGuess({
      lyricId: round.lyricId,
      guessType: dto.guessType,
      guessValue: dto.guessValue,
    });
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
      where: { userId, createdAt: MoreThanOrEqual(since) },
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
      const lyric = await queryBuilder
        .orderBy('RANDOM()')
        .take(1)
        .getOne();

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
   * Applies the optional category, decade and genre filters to a query.
   */
  private applyFilters(
    queryBuilder: SelectQueryBuilder<Lyrics>,
    options: RandomLyricOptions,
  ): void {
    if (options.category) {
      queryBuilder.andWhere('lyrics.category = :category', {
        category: options.category,
      });
    }

    if (options.decade) {
      queryBuilder.andWhere('lyrics.decade = :decade', {
        decade: options.decade,
      });
    }

    if (options.genre) {
      queryBuilder.andWhere('lyrics.genre = :genre', {
        genre: options.genre,
      });
    }
  }
}
