import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { normalizeDecade } from '../game/progression.util';
import { AdminLyricSortBy, SortOrder } from '../admin/dto/admin-query.dto';

/**
 * Maximum length of a lyric snippet served to players. Full lyric text is
 * never exposed; only a short snippet plus answer metadata is returned.
 */
export const MAX_LYRIC_SNIPPET_LENGTH = 150;

/**
 * Maximum number of random lyrics a player may request in one call.
 * Smaller than MAX_PAGE_SIZE to limit the query cost.
 */
export const MAX_RANDOM_COUNT = 20;

/**
 * Cache key holding the current lyrics namespace version. Every lyric cache
 * key embeds this version, so bumping it invalidates all lyric entries at
 * once — atomically, without a scan, and across every instance sharing the
 * store (in-memory or Redis).
 */
export const LYRICS_NAMESPACE_KEY = 'lyrics:ns';

export interface AdminLyricsFilter {
  limit: number;
  offset: number;
  sortBy?: AdminLyricSortBy;
  sortOrder?: SortOrder;
  isActive?: boolean;
  source?: string;
}

/** Admin sort keys mapped to entity columns. */
const ADMIN_LYRIC_SORT_COLUMNS: Record<AdminLyricSortBy, string> = {
  [AdminLyricSortBy.CREATED_AT]: 'lyrics.createdAt',
  [AdminLyricSortBy.TITLE]: 'lyrics.songTitle',
  [AdminLyricSortBy.ARTIST]: 'lyrics.artist',
};

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
   * Bumped on every invalidation. A read that started before a write must not
   * repopulate the cache with the data it loaded before that write. This is
   * only an in-process race guard; cross-instance invalidation is handled by
   * the shared namespace version key.
   */
  private cacheGeneration = 0;

  /**
   * All cache keys this instance has written, with the wall-clock time they
   * expire. Used by getCacheStats and the public clearCache to enumerate and
   * delete entries without a full-store scan.
   */
  private readonly trackedKeys = new Map<string, number>();

  constructor(
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    this.cacheTtlMs = cacheConfig.lyricsTtlMs;
  }

  /**
   * Reject snippets that exceed the content policy limit. Full lyric text is
   * never served to players, so the snippet is the only lyric surface and it
   * must stay short.
   */
  private assertSnippetWithinLimit(snippet: string): void {
    if (snippet.length > MAX_LYRIC_SNIPPET_LENGTH) {
      throw new BadRequestException(
        `lyricSnippet must be at most ${MAX_LYRIC_SNIPPET_LENGTH} characters`,
      );
    }
  }

  /**
   * Read the current namespace version from the shared cache. Defaults to 0
   * when unset so the first write simply starts the counter.
   */
  private async getNamespaceVersion(): Promise<number> {
    const version = await this.cacheManager.get<number>(LYRICS_NAMESPACE_KEY);
    return typeof version === 'number' ? version : 0;
  }

  /**
   * Build a cache key scoped to the current namespace version. Callers must
   * resolve the version first so the key reflects the latest invalidation.
   */
  private namespacedKey(version: number, key: string): string {
    return `lyrics:v${version}:${key}`;
  }

  /**
   * Store a value under `key`, recording the key so clearCache and
   * getCacheStats can enumerate it without a full-store scan.
   */
  private async setTracked(
    key: string,
    value: unknown,
    ttlMs: number,
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttlMs);
    this.trackedKeys.set(key, Date.now() + ttlMs);
  }

  /** Live keys: those whose recorded expiry is in the future. */
  private liveKeys(): string[] {
    const now = Date.now();
    return [...this.trackedKeys.entries()]
      .filter(([, exp]) => exp > now)
      .map(([k]) => k);
  }

  /**
   * Invalidate every lyric cache entry across all instances by advancing the
   * shared namespace version. Old keys become unreachable and expire via TTL.
   * Also deletes all tracked keys from the store so getCacheStats stays
   * accurate and the public clearCache can confirm an empty store.
   *
   * Returns `{ cleared: number }` when called publicly (via the controller).
   */
  async clearCache(): Promise<{ cleared: number }> {
    this.cacheGeneration += 1;

    const live = this.liveKeys();
    for (const key of live) {
      await this.cacheManager.del(key);
    }
    this.trackedKeys.clear();

    const current = await this.getNamespaceVersion();
    await this.cacheManager.set(
      LYRICS_NAMESPACE_KEY,
      current + 1,
      this.cacheTtlMs,
    );

    return { cleared: live.length };
  }

  /**
   * Alias for the controller's `POST /lyrics/cache/clear` endpoint.
   * Delegates to clearCache and discards the return value.
   */
  async invalidateCache(): Promise<void> {
    await this.clearCache();
  }

  /**
   * Cache statistics for the admin dashboard: how many live entries remain,
   * broken down by type.
   */
  async getCacheStats(): Promise<LyricsCacheStats> {
    const live = this.liveKeys();
    const keysByType = {
      lyrics: 0,
      random: 0,
      category: 0,
      search: 0,
    };
    for (const key of live) {
      if (key.startsWith(cacheConfig.keys.lyrics) || key.includes(':lyrics:')) {
        keysByType.lyrics += 1;
      } else if (key.startsWith(cacheConfig.keys.randomLyrics)) {
        keysByType.random += 1;
      } else if (key.startsWith(cacheConfig.keys.lyricsByCategory)) {
        keysByType.category += 1;
      } else if (key.startsWith(cacheConfig.keys.search)) {
        keysByType.search += 1;
      }
    }
    return { keys: live.length, keysByType, ttlMs: this.cacheTtlMs };
  }

  /**
   * Load a value from cache or run `loader` to populate it. The generation
   * check ensures a read that started before an invalidation does not
   * repopulate the cache with stale data.
   */
  private async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.cacheManager.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const generationBefore = this.cacheGeneration;
    const value = await loader();

    if (this.cacheGeneration === generationBefore) {
      await this.setTracked(key, value, ttlMs);
    }

    return value;
  }

  async create(createLyricsDto: CreateLyricsDto, user: User): Promise<Lyrics> {
    // Derive lyricSnippet from content when the caller did not supply one.
    // The entity column is non-nullable so we must guarantee a value here.
    const lyricSnippet =
      createLyricsDto.lyricSnippet?.trim() ||
      (createLyricsDto.content ?? '').slice(0, MAX_LYRIC_SNIPPET_LENGTH).trim();

    this.assertSnippetWithinLimit(lyricSnippet);
    if (!lyricSnippet) {
      throw new BadRequestException(
        'Either lyricSnippet or content must be provided',
      );
    }

    // Full lyric text is only used above to derive the snippet; it is never
    // stored (R2-89, CONTENT_POLICY.md).
    const fields = { ...createLyricsDto };
    delete fields.content;

    const lyrics = this.lyricsRepository.create({
      ...fields,
      content: null as unknown as string,
      lyricSnippet,
      addedBy: user?.id ?? null,
      // Store decades in the canonical "1990s" format used by the seed and
      // the MusicDecade preference enum.
      decade: createLyricsDto.decade
        ? normalizeDecade(createLyricsDto.decade.toString()) ?? undefined
        : undefined,
      createdBy: user,
    });
    const savedLyrics = (await this.lyricsRepository.save(lyrics)) as Lyrics;

    await this.clearCache();

    return savedLyrics;
  }

  /**
   * Paginated list of active lyrics, optionally filtered by genre and decade.
   * `limit` is capped at MAX_PAGE_SIZE so no caller can dump the whole table.
   */
  async findAll(
    genre?: string,
    decade?: number | string,
    limit: number = MAX_PAGE_SIZE,
    offset: number = 0,
  ): Promise<Lyrics[]> {
    const query = this.lyricsRepository
      .createQueryBuilder('lyrics')
      .leftJoinAndSelect('lyrics.createdBy', 'user');

    if (genre) {
      const validGenres = Object.values(Genre);
      if (!validGenres.includes(genre as Genre)) {
        throw new BadRequestException(
          `Invalid genre. Valid genres are: ${validGenres.join(', ')}`,
        );
      }
      query.andWhere('lyrics.genre = :genre', { genre });
    }

    if (decade !== undefined && decade !== null && decade !== '') {
      const decadeStr = normalizeDecade(decade.toString());
      if (!decadeStr) {
        throw new BadRequestException(
          'Invalid decade. Please provide a decade such as 1990 or 1990s',
        );
      }
      query.andWhere('lyrics.decade = :decade', { decade: decadeStr });
    }

    query.andWhere('lyrics.isActive = :isActive', { isActive: true });

    // Always capped: no caller can pull the whole table in one request.
    const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const safeOffset = Math.max(offset, 0);

    return query
      .orderBy('lyrics.id', 'ASC')
      .take(safeLimit)
      .skip(safeOffset)
      .getMany();
  }

  /**
   * Up to `count` random active lyrics, optionally filtered by genre and
   * decade. `count` is validated at the controller (1–20); the service also
   * clamps it as a defence-in-depth measure.
   */
  async getRandomLyrics(
    count: number = 1,
    genre?: string,
    decade?: number | string,
  ): Promise<Lyrics[]> {
    const safeCount = Math.min(Math.max(count, 1), MAX_RANDOM_COUNT);
    const genreKey = genre ?? 'all';
    const decadeKey = decade !== undefined && decade !== null && decade !== ''
      ? decade.toString()
      : 'all';
    const cacheKey = `${cacheConfig.keys.randomLyrics}${safeCount}:${genreKey}:${decadeKey}`;

    return this.getOrLoad(cacheKey, cacheConfig.randomLyricsTtlMs, async () => {
      const query = this.lyricsRepository.createQueryBuilder('lyrics');

      if (genre) {
        query.andWhere('lyrics.genre = :genre', { genre });
      }
      if (decade !== undefined && decade !== null && decade !== '') {
        const decadeStr = normalizeDecade(decade.toString());
        if (decadeStr) {
          query.andWhere('lyrics.decade = :decade', { decade: decadeStr });
        }
      }

      query
        .andWhere('lyrics.isActive = :isActive', { isActive: true })
        .orderBy('RANDOM()')
        .limit(safeCount);

      return query.getMany();
    });
  }

  /**
   * Active lyrics matching a category filter. `type` is either `'genre'` or
   * `'decade'`; `value` is the filter value.
   *
   * Results are paginated: at most MAX_PAGE_SIZE rows.
   */
  async getLyricsByCategory(
    type: string,
    value?: string,
    limit: number = MAX_PAGE_SIZE,
    offset: number = 0,
  ): Promise<Lyrics[]> {
    const filterValue = value ?? type;
    const cacheKey = `${cacheConfig.keys.lyricsByCategory}${type}:${filterValue}`;

    return this.getOrLoad(cacheKey, this.cacheTtlMs, async () => {
      const where: Record<string, unknown> = { isActive: true };

      if (type === 'decade') {
        const decadeStr = normalizeDecade(filterValue);
        if (!decadeStr) {
          throw new BadRequestException(
            'Invalid decade. Please provide a decade such as 1990 or 1990s',
          );
        }
        where['decade'] = decadeStr;
      } else {
        // Default: filter by genre field.
        where['genre'] = filterValue;
      }

      const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
      const safeOffset = Math.max(offset, 0);

      return this.lyricsRepository.find({
        where,
        relations: ['createdBy'],
        take: safeLimit,
        skip: safeOffset,
      });
    });
  }

  /**
   * Admin-only: returns every lyric by an artist regardless of active state.
   * Searching by artist is searching by answer, so it must never be player-
   * accessible.
   */
  async findByArtist(artist: string): Promise<Lyrics[]> {
    if (!artist?.trim()) {
      throw new BadRequestException('artist is required');
    }

    return this.lyricsRepository.find({
      where: { artist: artist.trim() },
      relations: ['createdBy'],
      take: MAX_PAGE_SIZE,
    });
  }

  /**
   * Admin-only full-text search across lyric fields (snippet, title, artist).
   * Results are paginated with limit/offset.
   */
  async searchLyrics(
    q: string,
    offset: number = 0,
    limit: number = 20,
  ): Promise<Lyrics[]> {
    if (!q?.trim()) {
      throw new BadRequestException('Search query is required');
    }

    const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const safeOffset = Math.max(offset, 0);
    const cacheKey = `${cacheConfig.keys.search}${q}:${safeOffset}:${safeLimit}`;

    return this.getOrLoad(cacheKey, cacheConfig.searchTtlMs, async () => {
      const term = `%${q.trim()}%`;
      return this.lyricsRepository
        .createQueryBuilder('lyrics')
        .leftJoinAndSelect('lyrics.createdBy', 'user')
        .where('lyrics.lyricSnippet ILIKE :term', { term })
        .orWhere('lyrics.songTitle ILIKE :term', { term })
        .orWhere('lyrics.artist ILIKE :term', { term })
        .orderBy('lyrics.id', 'ASC')
        .take(safeLimit)
        .skip(safeOffset)
        .getMany();
    });
  }

  /**
   * Count lyrics, optionally filtered by active state. Used by the admin
   * listing to populate pagination metadata.
   */
  async count(isActive?: boolean): Promise<number> {
    if (isActive === undefined) {
      return this.lyricsRepository.count();
    }

    return this.lyricsRepository.count({ where: { isActive } });
  }

  /**
   * Admin listing: every lyric regardless of state unless `isActive` is set,
   * optionally narrowed to one source. Returns the page and the total count
   * for the same filter.
   */
  async findAllForAdmin(
    filter: AdminLyricsFilter,
  ): Promise<{ data: Lyrics[]; total: number }> {
    const query = this.lyricsRepository.createQueryBuilder('lyrics');

    if (filter.isActive !== undefined) {
      query.andWhere('lyrics.isActive = :isActive', {
        isActive: filter.isActive,
      });
    }
    if (filter.source) {
      query.andWhere('lyrics.source = :source', {
        source: LyricsService.normalizeSource(filter.source),
      });
    }

    const sortColumn =
      ADMIN_LYRIC_SORT_COLUMNS[filter.sortBy ?? AdminLyricSortBy.CREATED_AT];
    const [data, total] = await query
      .orderBy(sortColumn, filter.sortOrder ?? SortOrder.DESC)
      .addOrderBy('lyrics.id', 'ASC')
      .take(Math.min(Math.max(filter.limit, 1), MAX_PAGE_SIZE))
      .skip(Math.max(filter.offset, 0))
      .getManyAndCount();

    return { data, total };
  }

  /**
   * Deactivates every active lyric from one source in a single statement,
   * e.g. after a rights holder's takedown request. Returns the ids that were
   * deactivated so the admin can restore individual lyrics later.
   */
  async deactivateBySource(
    source: string,
  ): Promise<{ source: string; deactivated: number; ids: number[] }> {
    const normalized = LyricsService.normalizeSource(source);
    if (!normalized) {
      throw new BadRequestException('source is required');
    }

    const result = await this.lyricsRepository
      .createQueryBuilder()
      .update(Lyrics)
      .set({ isActive: false })
      .where({ source: normalized, isActive: true })
      .returning(['id'])
      .execute();

    const ids = (result.raw as Array<{ id: number }>).map((row) => row.id);
    if (ids.length > 0) {
      await this.clearCache();
    }

    return { source: normalized, deactivated: ids.length, ids };
  }

  /** Sources are stored trimmed and lower-cased; see CreateLyricsDto. */
  static normalizeSource(source: string): string {
    return source.trim().toLowerCase();
  }

  async findOne(id: number): Promise<Lyrics> {
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    const version = await this.getNamespaceVersion();
    const cacheKey = this.namespacedKey(
      version,
      `${cacheConfig.keys.lyrics}${id}`,
    );

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

  /**
   * Load a lyric regardless of its active state. Admin-only: used by the
   * restore flow, which must be able to see soft-deleted (inactive) lyrics.
   * Bypasses the cache so a stale active-only entry cannot mask the row.
   */
  async findOneIncludingInactive(id: number): Promise<Lyrics> {
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    const dbLyrics = await this.lyricsRepository.findOne({
      where: { id },
      relations: ['createdBy'],
    });

    if (!dbLyrics) {
      throw new NotFoundException('Lyrics not found');
    }

    return dbLyrics;
  }

  /**
   * Restore a soft-deleted lyric by setting isActive back to true. Throws
   * ConflictException when the lyric is already active.
   */
  async restore(id: number): Promise<Lyrics> {
    const lyrics = await this.findOneIncludingInactive(id);

    if (lyrics.isActive) {
      throw new ConflictException('Lyrics is already active');
    }

    lyrics.isActive = true;
    const restored = await this.lyricsRepository.save(lyrics);

    await this.clearCache();

    return restored;
  }

  async update(
    id: number,
    updateLyricsDto: UpdateLyricsDto,
    user: User,
  ): Promise<Lyrics> {
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

    Object.assign(lyrics, updateLyricsDto);
    if ('updatedAt' in lyrics) {
      (lyrics as unknown as { updatedAt: Date }).updatedAt = new Date();
    }

    const saved = await this.lyricsRepository.save(lyrics);
    await this.clearCache();

    return saved;
  }

  async remove(id: number): Promise<void> {
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid lyrics ID');
    }

    const lyrics = await this.lyricsRepository.findOne({
      where: { id },
    });

    if (!lyrics) {
      throw new NotFoundException('Lyrics not found');
    }

    await this.lyricsRepository.remove(lyrics);
    await this.clearCache();
  }
}
