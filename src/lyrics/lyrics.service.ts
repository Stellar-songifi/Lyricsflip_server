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
    return this.getOrLoad(cacheKey, cacheConfig.randomTtlMs, async () => {
      const query = this.lyricsRepository
        .createQueryBuilder('lyrics')
        .leftJoinAndSelect('lyrics.createdBy', 'user')
        .where('lyrics.isActive = :isActive', { isActive: true });

      if (genre) {
        query.andWhere('lyrics.genre = :genre', { genre });
      }

      if (decade) {
        query.andWhere('lyrics.decade = :decade', { decade: decade.toString() });
      }

      return query.orderBy('RANDOM()').take(count).getMany();
    });
  }

  /**
   * Search lyrics by term across title, artist and content.
   * Admin-only at the route level: it matches answer fields (content),
   * so it must not be exposed to regular players (issue #121).
   */
  async searchLyrics(term: string): Promise<Lyrics[]> {
    if (!term || !term.trim()) {
      throw new BadRequestException('Search term is required');
    }

    const normalized = term.trim().toLowerCase();
    const cacheKey = `${cacheConfig.keys.search}${normalized}`;

    return this.getOrLoad(cacheKey, this.cacheTtlMs, async () => {
      return this.lyricsRepository
        .createQueryBuilder('lyrics')
        .leftJoinAndSelect('lyrics.createdBy', 'user')
        .where('lyrics.isActive = :isActive', { isActive: true })
        .andWhere(
          '(lyrics.title ILIKE :term OR lyrics.artist ILIKE :term OR lyrics.content ILIKE :term)',
          { term: `%${normalized}%` },
        )
        .orderBy('lyrics.id', 'ASC')
        .take(MAX_PAGE_SIZE)
        .getMany();
    });
  }

  /**
   * Read-through cache helper. Records the key so clearCache can drop it,
   * and skips repopulating when a write invalidated the cache mid-read.
   */
  private async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.cacheManager.get<T>(key);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const generation = this.cacheGeneration;
    const value = await loader();

    // A write happened while we were loading; don't cache stale data.
    if (generation !== this.cacheGeneration) {
      return value;
    }

    await this.cacheManager.set(key, value, ttlMs);
    this.cachedKeys.set(key, Date.now() + ttlMs);

    return value;
  }

  /**
   * Drop every lyrics cache entry (lyrics, random, category and search).
   * Called on create/update/remove so search results refresh on writes.
   */
  private async clearCache(): Promise<void> {
    this.cacheGeneration += 1;

    const now = Date.now();
    const deletions: Promise<unknown>[] = [];

    for (const [key, expiresAt] of this.cachedKeys) {
      if (expiresAt <= now) {
        this.cachedKeys.delete(key);
        continue;
      }
      deletions.push(this.cacheManager.del(key));
      this.cachedKeys.delete(key);
    }

    await Promise.all(deletions);
  }

  /**
   * Cache statistics for the admin cache dashboard.
   */
  getCacheStats(): LyricsCacheStats {
    const now = Date.now();
    const keysByType = { lyrics: 0, random: 0, category: 0, search: 0 };

    for (const [key, expiresAt] of this.cachedKeys) {
      if (expiresAt <= now) {
        continue;
      }
      if (key.startsWith(cacheConfig.keys.search)) {
        keysByType.search += 1;
      } else if (key.startsWith(cacheConfig.keys.randomLyrics)) {
        keysByType.random += 1;
      } else if (key.startsWith(cacheConfig.keys.category)) {
        keysByType.category += 1;
      } else if (key.startsWith(cacheConfig.keys.lyrics)) {
        keysByType.lyrics += 1;
      }
    }

    return {
      keys: this.cachedKeys.size,
      keysByType,
      ttlMs: this.cacheTtlMs,
    };
  }
}
