import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Lyrics } from './entities/lyrics.entity';
import { CreateLyricsDto } from './dto/create-lyrics.dto';
import { UpdateLyricsDto } from './dto/update-lyrics.dto';
import { User } from '../users/entities/user.entity';
import { cacheConfig } from '../config/cache.config';
import { Genre } from './entities/genre.enum';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';

export interface LyricsCacheStats {
  keys: number;
  keysByType: {
    lyrics: number;
    random: number;
    category: number;
    search: number;
  };
  ttlMs: number;
}

@Injectable()
export class LyricsService {
  private readonly cacheTtlMs: number;

  /**
   * Every lyrics cache key this service has written, with its expiry time.
   * cache-manager has no prefix delete, so invalidation deletes these keys.
   * The global store is in-memory and per-process, which this matches;
   * moving to Redis (issue #115) would replace this with a prefix scan.
   */
  private readonly cachedKeys = new Map<string, number>();

  /**
   * Bumped on every invalidation. A read that started before a write must not
   * repopulate the cache with the data it loaded before that write.
   */
  private cacheGeneration = 0;

  constructor(
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    this.cacheTtlMs = cacheConfig.lyricsTtlMs;
  }

  async create(createLyricsDto: CreateLyricsDto, user: User): Promise<Lyrics> {
    // Derive lyricSnippet from content when the caller did not supply one.
    // The entity column is non-nullable so we must guarantee a value here.
    const lyricSnippet =
      createLyricsDto.lyricSnippet?.trim() ||
      createLyricsDto.content.slice(0, 150).trim();

    const lyrics = this.lyricsRepository.create({
      ...createLyricsDto,
      lyricSnippet,
      decade: createLyricsDto.decade?.toString(), // entity stores decade as varchar
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

    const cacheKey = `${cacheConfig.keys.lyrics}${id}`;

    return this.getOrLoad(cacheKey, this.cacheTtlMs, async () => {
      const dbLyrics = await this.lyricsRepository.findOne({
        where: { id, isActive: true },
        relations: ['createdBy'],
      });

      if (!dbLyrics) {
        throw new NotFoundException('Lyrics not found');
      }

      return dbLyrics;
    });
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

    // The edited lyric may appear in any list, category, random or search
    // result, so drop every lyrics cache entry, not just lyrics:{id}.
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

    // Drop every lyrics cache entry that could still contain this lyric
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

    // Random data gets a shorter TTL so repeated requests still vary
    return this.getOrLoad(cacheKey, cacheConfig.randomLyricsTtlMs, () =>
      this.fetchRandomLyricsFromDB(count, genre, decade),
    );
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

    return this.getOrLoad(cacheKey, this.cacheTtlMs, () => {
      const whereClause: Record<string, any> = {
        [category]: category === 'decade' ? value.toString() : value,
        isActive: true,
      };

      return this.lyricsRepository.find({
        where: whereClause,
        relations: ['createdBy'],
      });
    });
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

    return this.getOrLoad(cacheKey, cacheConfig.searchTtlMs, () =>
      this.lyricsRepository
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
        .getMany(),
    );
  }

  /**
   * Clear all lyrics-related caches
   * Useful for development or admin purposes
   */
  async clearCache(): Promise<{ cleared: number }> {
    // Bump first so in-flight reads cannot write stale data back afterwards
    this.cacheGeneration++;
    const keys = [...this.cachedKeys.keys()];
    this.cachedKeys.clear();

    try {
      await Promise.all(keys.map((key) => this.cacheManager.del(key)));
    } catch (error) {
      // Don't fail the write that triggered invalidation; entries still
      // expire by TTL.
      console.warn('Cache clearing failed:', error);
    }

    return { cleared: keys.length };
  }

  /**
   * Get cache statistics (useful for monitoring). Counts the live lyrics
   * entries this service has written, grouped by key type.
   */
  getCacheStats(): LyricsCacheStats {
    this.pruneExpiredKeys();

    const { keys: prefixes } = cacheConfig;
    const keysByType = { lyrics: 0, random: 0, category: 0, search: 0 };
    for (const key of this.cachedKeys.keys()) {
      if (key.startsWith(prefixes.randomLyrics)) keysByType.random++;
      else if (key.startsWith(prefixes.lyricsByCategory)) keysByType.category++;
      else if (key.startsWith(prefixes.lyrics)) keysByType.lyrics++;
      else keysByType.search++;
    }

    return {
      keys: this.cachedKeys.size,
      keysByType,
      ttlMs: this.cacheTtlMs,
    };
  }

  /**
   * Returns the cached value for key, or loads it, caches it and records the
   * key so clearCache can find it.
   */
  private async getOrLoad<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    // Captured before any await so a write during the lookup is also seen
    const generation = this.cacheGeneration;

    const cached = await this.cacheManager.get<T>(key);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const value = await load();

    // Skip caching if the lyrics changed while this read was in flight
    if (generation === this.cacheGeneration) {
      await this.cacheManager.set(key, value, ttlMs);
      this.cachedKeys.set(key, Date.now() + ttlMs);
    }

    return value;
  }

  private pruneExpiredKeys(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.cachedKeys) {
      if (expiresAt <= now) this.cachedKeys.delete(key);
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
