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

/**
 * Maximum length of a lyric snippet served to players. Full lyric text is
 * never exposed; only a short snippet plus answer metadata is returned.
 */
export const MAX_LYRIC_SNIPPET_LENGTH = 150;

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

  async create(createLyricsDto: CreateLyricsDto, user: User): Promise<Lyrics> {
    // Derive lyricSnippet from content when the caller did not supply one.
    // The entity column is non-nullable so we must guarantee a value here.
    const lyricSnippet =
      createLyricsDto.lyricSnippet?.trim() ||
      (createLyricsDto.content ?? '').slice(0, MAX_LYRIC_SNIPPET_LENGTH).trim();

    this.assertSnippetWithinLimit(lyricSnippet);

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

    if (updateLyricsDto.lyricSnippet !== undefined) {
      this.assertSnippetWithinLimit(updateLyricsDto.lyricSnippet.trim());
    }

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
   * Normalise a value for alias comparison: lower-case, trim, and collapse
   * internal whitespace so "JAY Z" and "Jay-Z" compare equal.
   */
  private normalizeAnswer(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Check whether a guess matches the canonical value or any of its aliases.
   * Comparison is case- and punctuation-insensitive so "Jay-Z" matches
   * "JAY Z" and "WizKid" matches "Wizkid".
   */
  matchesAnswer(
    guess: string,
    canonical: string,
    aliases: string[] = [],
  ): boolean {
    if (!guess) {
      return false;
    }

    const normalizedGuess = this.normalizeAnswer(guess);
    if (!normalizedGuess) {
      return false;
    }

    const candidates = [canonical, ...(aliases ?? [])];
    return candidates.some(
      (candidate) =>
        candidate != null &&
        this.normalizeAnswer(candidate) === normalizedGuess,
    );
  }

  /**
   * Score a guess against a lyric's canonical artist/title and their aliases.
   * A guess that matches an alias is scored as correct.
   */
  scoreGuess(
    lyrics: Lyrics,
    guess: { artist?: string; title?: string },
  ): { artistCorrect: boolean; titleCorrect: boolean } {
    return {
      artistCorrect: this.matchesAnswer(
        guess.artist ?? '',
        lyrics.artist,
        lyrics.artistAliases,
      ),
      titleCorrect: this.matchesAnswer(
        guess.title ?? '',
        lyrics.title,
        lyrics.titleAliases,
      ),
    };
  }

  /*

/* … truncated 1609 chars — edit only what you need near the top … */
