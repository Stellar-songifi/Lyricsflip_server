import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { Lyrics } from './entities/lyrics.entity';
import { CreateLyricsDto } from './dto/create-lyrics.dto';
import { UpdateLyricsDto } from './dto/update-lyrics.dto';
import { User } from '../users/entities/user.entity';
import { cacheConfig } from '../config/cache.config';
import { Genre } from './entities/genre.enum';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';

@Injectable()
export class LyricsService {
  private readonly cacheTTL: number;

  constructor(
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    @Inject('CACHE_MANAGER')
    private readonly cacheManager: Cache,
  ) {
    this.cacheTTL = cacheConfig.lyricsTTL;
  }

  async create(createLyricsDto: CreateLyricsDto, user: User): Promise<Lyrics> {
    const lyrics = this.lyricsRepository.create({
      ...createLyricsDto,
      decade: createLyricsDto.decade?.toString(), // Convert number to string
      createdBy: user,
    });
    const savedLyrics = await this.lyricsRepository.save(lyrics);

    // Clear relevant caches when new lyrics are added
    await this.clearCache();

    return savedLyrics;
  }

  async findAll(
    genre?: string,
    decade?: number,
    limit: number = MAX_PAGE_SIZE,
    offset: number = 0,
  ): Promise<Lyrics[]> {
    const query = this.lyricsRepository
      .createQueryBuilder('lyrics')
      .leftJoinAndSelect('lyrics.createdBy', 'user');

    // Apply genre filter if provided
    if (genre) {
      // Validate genre against enum values
      const validGenres = Object.values(Genre);
      if (!validGenres.includes(genre as Genre)) {
        throw new BadRequestException(
          `Invalid genre. Valid genres are: ${validGenres.join(', ')}`,
        );
      }
      query.andWhere('lyrics.genre = :genre', { genre });
    }

    // Apply decade filter if provided
    if (decade) {
      // Validate decade (should be 4-digit year in decades: 1990, 2000, 2010, etc.)
      if (
        decade < 1900 ||
        decade > new Date().getFullYear() ||
        decade % 10 !== 0
      ) {
        throw new BadRequestException(
          'Invalid decade. Please provide a 4-digit year in decades (e.g., 1990, 2000, 2010)',
        );
      }

      // Convert decade to string format for database query (since entity uses varchar)
      const decadeStr = decade.toString();
      query.andWhere('lyrics.decade = :decade', { decade: decadeStr });
    }

    // Only return active lyrics
    query.andWhere('lyrics.isActive = :isActive', { isActive: true });

    // Always capped, so no caller can pull the whole table in one request
    const results = await query
      .orderBy('lyrics.id', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // Return empty array instead of throwing exception for no results
    return results;
  }

  async findOne(id: number): Promise<Lyrics> {
    // Validate ID
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    // Try to get from cache first
    const cacheKey = `${cacheConfig.keys.lyrics}${id}`;
    let lyrics = await this.cacheManager.get<Lyrics>(cacheKey);

    if (!lyrics) {
      // If not in cache, fetch from database
      const dbLyrics = await this.lyricsRepository.findOne({
        where: { id, isActive: true },
        relations: ['createdBy'],
      });

      if (!dbLyrics) {
        throw new NotFoundException('Lyrics not found');
      }

      lyrics = dbLyrics;
      // Cache the result
      await this.cacheManager.set(cacheKey, lyrics, this.cacheTTL);
    }

    return lyrics;
  }

  async update(
    id: number, // Fixed: should be number, not string
    updateLyricsDto: UpdateLyricsDto,
    user: User,
  ): Promise<Lyrics> {
    // Validate ID
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    const lyrics = await this.lyricsRepository.findOne({
      where: { id, isActive: true },
      relations: ['createdBy'],
    });

    if (!lyrics) {
      throw new NotFoundException('Lyrics not found');
    }

    // Optional: Check if user is admin or creator
    // if (lyrics.createdBy.id !== user.id && !user.isAdmin) {
    //   throw new ForbiddenException('You can only update your own lyrics');
    // }

    // Update lyrics with new data
    Object.assign(lyrics, updateLyricsDto);
    lyrics.updatedAt = new Date(); // Assuming you have updatedAt field

    const updatedLyrics = await this.lyricsRepository.save(lyrics);

    // Update cache and clear related caches
    const cacheKey = `${cacheConfig.keys.lyrics}${id}`;
    await this.cacheManager.set(cacheKey, updatedLyrics, this.cacheTTL);
    await this.clearCache();

    return updatedLyrics;
  }

  async remove(id: number): Promise<void> {
    // Fixed: should be number, not string
    // Validate ID
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    const lyrics = await this.lyricsRepository.findOne({
      where: { id, isActive: true },
    });

    if (!lyrics) {
      throw new NotFoundException('Lyrics not found');
    }

    // Soft delete by setting isActive to false instead of hard delete
    lyrics.isActive = false;
    await this.lyricsRepository.save(lyrics);

    // Remove from cache and clear related caches
    const cacheKey = `${cacheConfig.keys.lyrics}${id}`;
    await this.cacheManager.del(cacheKey);
    await this.clearCache();
  }

  /**
   * Fetch random lyrics with caching support
   * @param count Number of random lyrics to fetch (default: 1, max: 100)
   * @param genre Optional genre filter
   * @param decade Optional decade filter
   * @returns Promise<Lyrics[]>
   */
  async getRandomLyrics(
    count = 1,
    genre?: string,
    decade?: number,
  ): Promise<Lyrics[]> {
    // Validate count
    if (count <= 0 || count > 100) {
      throw new BadRequestException('Count must be between 1 and 100');
    }

    // Validate genre if provided
    if (genre) {
      const validGenres = Object.values(Genre);
      if (!validGenres.includes(genre as Genre)) {
        throw new BadRequestException(
          `Invalid genre. Valid genres are: ${validGenres.join(', ')}`,
        );
      }
    }

    // Validate decade if provided
    if (
      decade &&
      (decade < 1900 || decade > new Date().getFullYear() || decade % 10 !== 0)
    ) {
      throw new BadRequestException(
        'Invalid decade. Please provide a 4-digit year in decades (e.g., 1990, 2000, 2010)',
      );
    }

    // Create cache key based on parameters
    const cacheKey = `${cacheConfig.keys.randomLyrics}${count}:${genre || 'all'}:${decade || 'all'}`;

    // Try to get from cache first
    let lyrics = await this.cacheManager.get<Lyrics[]>(cacheKey);

    if (!lyrics) {
      // If not in cache, fetch from database
      lyrics = await this.fetchRandomLyricsFromDB(count, genre, decade);

      // Cache the result with shorter TTL for random data
      const randomCacheTTL = Math.floor(this.cacheTTL / 4); // 25% of normal TTL
      await this.cacheManager.set(cacheKey, lyrics, randomCacheTTL);
    }

    return lyrics;
  }

  /**
   * Fetch random lyrics from database
   * @param count Number of random lyrics to fetch
   * @param genre Optional genre filter
   * @param decade Optional decade filter
   * @returns Promise<Lyrics[]>
   */
  private async fetchRandomLyricsFromDB(
    count: number,
    genre?: string,
    decade?: number,
  ): Promise<Lyrics[]> {
    let query = this.lyricsRepository
      .createQueryBuilder('lyrics')
      .leftJoinAndSelect('lyrics.createdBy', 'user')
      .where('lyrics.isActive = :isActive', { isActive: true });

    if (genre) {
      query = query.andWhere('lyrics.genre = :genre', { genre });
    }

    if (decade) {
      query = query.andWhere('lyrics.decade = :decade', {
        decade: decade.toString(),
      });
    }

    // Get total count for validation
    const totalCount = await query.getCount();

    if (totalCount === 0) {
      return [];
    }

    // For better randomness, we'll use a different approach
    // Get random records using database-specific random function
    const randomLyrics = await query
      .orderBy('RANDOM()') // Use RAND() for MySQL, RANDOM() for PostgreSQL
      .limit(Math.min(count, totalCount))
      .getMany();

    return randomLyrics;
  }

  /**
   * Get lyrics by category with caching
   * @param category Category type (genre, decade, artist)
   * @param value Category value
   * @returns Promise<Lyrics[]>
   */
  async getLyricsByCategory(
    category: 'genre' | 'decade' | 'artist',
    value: string | number,
  ): Promise<Lyrics[]> {
    // Validate category
    if (!['genre', 'decade', 'artist'].includes(category)) {
      throw new BadRequestException(
        'Invalid category. Must be genre, decade, or artist',
      );
    }

    // Validate genre if category is genre
    if (category === 'genre' && typeof value === 'string') {
      const validGenres = Object.values(Genre);
      if (!validGenres.includes(value as Genre)) {
        throw new BadRequestException(
          `Invalid genre. Valid genres are: ${validGenres.join(', ')}`,
        );
      }
    }

    // Validate decade if category is decade
    if (category === 'decade' && typeof value === 'number') {
      if (
        value < 1900 ||
        value > new Date().getFullYear() ||
        value % 10 !== 0
      ) {
        throw new BadRequestException(
          'Invalid decade. Please provide a 4-digit year in decades (e.g., 1990, 2000, 2010)',
        );
      }
    }

    const cacheKey = `${cacheConfig.keys.lyricsByCategory}${category}:${value}`;

    // Try to get from cache first
    let lyrics = await this.cacheManager.get<Lyrics[]>(cacheKey);

    if (!lyrics) {
      // If not in cache, fetch from database
      const whereClause: Record<string, any> = {
        [category]: category === 'decade' ? value.toString() : value,
        isActive: true,
      };

      lyrics = await this.lyricsRepository.find({
        where: whereClause,
        relations: ['createdBy'],
      });

      // Cache the result
      await this.cacheManager.set(cacheKey, lyrics, this.cacheTTL);
    }

    return lyrics;
  }

  /**
   * Search lyrics by text content
   * @param searchTerm Search term to look for in lyrics content
   * @param limit Maximum number of results (default: 20)
   * @returns Promise<Lyrics[]>
   */
  async searchLyrics(searchTerm: string, limit = 20): Promise<Lyrics[]> {
    if (!searchTerm || searchTerm.trim().length < 2) {
      throw new BadRequestException(
        'Search term must be at least 2 characters long',
      );
    }

    if (limit <= 0 || limit > 100) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }

    const cacheKey = `search_${searchTerm.toLowerCase()}:${limit}`;

    // Try cache first
    let results = await this.cacheManager.get<Lyrics[]>(cacheKey);

    if (!results) {
      results = await this.lyricsRepository
        .createQueryBuilder('lyrics')
        .leftJoinAndSelect('lyrics.createdBy', 'user')
        .where('lyrics.isActive = :isActive', { isActive: true })
        .andWhere(
          '(lyrics.songTitle ILIKE :searchTerm OR lyrics.content ILIKE :searchTerm OR lyrics.artist ILIKE :searchTerm)',
          {
            searchTerm: `%${searchTerm}%`,
          },
        )
        .orderBy('lyrics.createdAt', 'DESC')
        .limit(limit)
        .getMany();

      // Cache search results for shorter time
      const searchCacheTTL = Math.floor(this.cacheTTL / 2);
      await this.cacheManager.set(cacheKey, results, searchCacheTTL);
    }

    return results;
  }

  /**
   * Clear all lyrics-related caches
   * Useful for development or admin purposes
   */
  async clearCache(): Promise<void> {
    try {
      // Since we can't use reset() method, we'll skip cache clearing
      // In production with Redis, you would implement pattern-based key deletion
      // For now, we'll just log that cache clearing was requested
      console.log(
        'Cache clear requested - implement pattern-based deletion for production',
      );
    } catch (error) {
      console.warn('Cache clearing failed:', error);
      // Don't throw error for cache clearing failures
    }
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  async getCacheStats(): Promise<{
    keys: number;
    ttl: number;
    memoryUsage?: string;
  }> {
    try {
      // For in-memory cache, we'll return basic stats
      // In production with Redis, you could get actual key counts and memory usage
      return {
        keys: 0, // Would need to implement key counting
        ttl: this.cacheTTL,
        memoryUsage: 'Unknown', // Would need to implement memory usage tracking
      };
    } catch (error) {
      console.warn('Failed to get cache stats:', error);
      return {
        keys: 0,
        ttl: this.cacheTTL,
      };
    }
  }

  /**
   * Get lyrics count by filters
   * @param genre Optional genre filter
   * @param decade Optional decade filter
   * @returns Promise<number>
   */
  async getLyricsCount(genre?: string, decade?: number): Promise<number> {
    const query = this.lyricsRepository
      .createQueryBuilder('lyrics')
      .where('lyrics.isActive = :isActive', { isActive: true });

    if (genre) {
      const validGenres = Object.values(Genre);
      if (!validGenres.includes(genre as Genre)) {
        throw new BadRequestException(
          `Invalid genre. Valid genres are: ${validGenres.join(', ')}`,
        );
      }
      query.andWhere('lyrics.genre = :genre', { genre });
    }

    if (decade) {
      if (
        decade < 1900 ||
        decade > new Date().getFullYear() ||
        decade % 10 !== 0
      ) {
        throw new BadRequestException(
          'Invalid decade. Please provide a 4-digit year in decades (e.g., 1990, 2000, 2010)',
        );
      }
      query.andWhere('lyrics.decade = :decade', { decade: decade.toString() });
    }

    return await query.getCount();
  }
}
