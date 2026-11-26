import { listPlayerReports, resolvePlayerReport } from '../moderation/player-report.store';
import { AdminPlayerReportQueryDto, ResolvePlayerReportDto } from '../moderation/player-report.dto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { toPaginated } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { GrantMockBalanceMode } from './dto/grant-mock-balance.dto';
import { MockTokenService } from '../tokens/services/mock-token.service';
import { UsersService } from '../users/users.service';
import { LyricsService } from '../lyrics/lyrics.service';
import { CreateLyricDto } from '../lyrics/dto/create-lyric.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminLyricQueryDto, AdminUserQueryDto } from './dto/admin-query.dto';
import { parse } from 'csv-parse/sync';

export type LyricsImportMode = 'create-only' | 'upsert';

export interface LyricsImportRowReport {
  row: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  errors?: string[];
}

export interface LyricsImportReport {
  dryRun: boolean;
  mode: LyricsImportMode;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: LyricsImportRowReport[];
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number; hasNext: boolean };
}

export interface AnalyticsOverview {
  from: string;
  to: string;
  dau: number;
  wau: number;
  newSignups: number;
  rounds: number;
  accuracy: number;
  wagers: {
    created: number;
    settled: number;
    refunded: number;
    failed: number;
    totalStaked: string;
  };
}

export interface LyricAccuracyRow {
  lyricId: number;
  artist: string;
  songTitle: string;
  attempts: number;
  correct: number;
  accuracy: number;
}

interface ParsedImportRow {
  line: number;
  data: Record<string, unknown>;
}

const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AdminService {
  private readonly analyticsCache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mockTokenService: MockTokenService,
    private readonly usersService: UsersService,
    private readonly lyricsService: LyricsService,
  ) {}

  async findAllReports(query: AdminPlayerReportQueryDto) {
    return listPlayerReports(this.userRepository.manager, query);
  }

  async resolveReport(id: string, adminId: string, dto: ResolvePlayerReportDto) {
    return resolvePlayerReport(this.userRepository.manager, id, adminId, dto);
  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.analyticsCache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }
    const value = await loader();
    this.analyticsCache.set(key, {
      expiresAt: now + ANALYTICS_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  private resolveRange(from?: string, to?: string): { from: Date; to: Date } {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (fromDate > toDate) {
      throw new BadRequestException('`from` must be before `to`');
    }
    return { from: fromDate, to: toDate };
  }

  async getAnalyticsOverview(from?: string, to?: string): Promise<AnalyticsOverview> {
    const range = this.resolveRange(from, to);
    const cacheKey = `overview:${range.from.toISOString()}:${range.to.toISOString()}`;
    return this.cached(cacheKey, async () => {
      const { from: fromDate, to: toDate } = range;
      const wauFrom = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [dau, wau, newSignups, rounds, accuracy, wagers] = await Promise.all([
        this.countDistinctActiveUsers(fromDate, toDate),
        this.countDistinctActiveUsers(wauFrom, toDate),
        this.userRepository
          .createQueryBuilder('user')
          .where('user.createdAt BETWEEN :from AND :to', {
            from: fromDate,
            to: toDate,
          })
          .getCount(),
        this.countRounds(fromDate, toDate),
        this.computeAccuracy(fromDate, toDate),
        this.computeWagerStats(fromDate, toDate),
      ]);

      return {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        dau,
        wau,
        newSignups,
        rounds,
        accuracy,
        wagers,
      };
    });
  }

  async getLyricAccuracy(
    sort: 'accuracy' | 'attempts' = 'accuracy',
    from?: string,
    to?: string,
  ): Promise<LyricAccuracyRow[]> {
    const range = this.resolveRange(from, to);
    const cacheKey = `lyrics:${sort}:${range.from.toISOString()}:${range.to.toISOString()}`;
    return this.cached(cacheKey, async () => {
      const order = sort === 'attempts' ? 'attempts' : 'accuracy';
      const rows = await this.userRepository.manager.query(
        `SELECT lyric_id AS "lyricId",
                artist,
                song_title AS "songTitle",
                COUNT(*)::int AS attempts,
                SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::int AS correct
           FROM round_attempts
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY lyric_id, artist, song_title
          ORDER BY ${order} ASC, attempts DESC
          LIMIT 200`,
        [range.from, range.to],
      );
      return (rows as Array<Record<string, unknown>>).map((row) => {
        const attempts = Number(row.attempts ?? 0);
        const correct = Number(row.correct ?? 0);
        return {
          lyricId: Number(row.lyricId),
          artist: String(row.artist ?? ''),
          songTitle: String(row.songTitle ?? ''),
          attempts,
          correct,
          accuracy: attempts > 0 ? correct / attempts : 0,
        };
      });
    });
  }

  private async countDistinctActiveUsers(from: Date, to: Date): Promise<number> {
    const rows = await this.userRepository.manager.query(
      `SELECT COUNT(DISTINCT user_id)::int AS count
         FROM round_attempts
        WHERE created_at BETWEEN $1 AND $2`,
      [from, to],
    );
    return Number((rows as Array<{ count: number }>)[0]?.count ?? 0);
  }

  private async countRounds(from: Date, to: Date): Promise<number> {
    const rows = await this.userRepository.manager.query(
      `SELECT COUNT(*)::int AS count
         FROM rounds
        WHERE created_at BETWEEN $1 AND $2`,
      [from, to],
    );
    return Number((rows as Array<{ count: number }>)[0]?.count ?? 0);
  }

  private async computeAccuracy(from: Date, to: Date): Promise<number> {
    const rows = await this.userRepository.manager.query(
      `SELECT COUNT(*)::int AS attempts,
              SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::int AS correct
         FROM round_attempts
        WHERE created_at BETWEEN $1 AND $2`,
      [from, to],
    );
    const row = (rows as Array<{ attempts: number; correct: number }>)[0];
    const attempts = Number(row?.attempts ?? 0);
    const correct = Number(row?.correct ?? 0);
    return attempts > 0 ? correct / attempts : 0;
  }

  private async computeWagerStats(from: Date, to: Date) {
    const rows = await this.userRepository.manager.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'created')::int AS created,
          COUNT(*) FILTER (WHERE status = 'settled')::int AS settled,
          COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status IN ('created', 'settled')), 0)::text AS "totalStaked"
         FROM wagers
        WHERE created_at BETWEEN $1 AND $2`,
      [from, to],
    );
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    return {
      created: Number(row.created ?? 0),
      settled: Number(row.settled ?? 0),
      refunded: Number(row.refunded ?? 0),
      failed: Number(row.failed ?? 0),
      totalStaked: String(row.totalStaked ?? '0'),
    };
  }

  async grantMockBalance(
    userId: string,
    amount: string,
    mode: GrantMockBalanceMode = GrantMockBalanceMode.ADD,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.mockTokenService.grantMockBalance(userId, amount, mode);
  }

  async findAllUsers(
    query: AdminUserQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const [data, total] = await Promise.all([
      this.usersService.findAll(limit, offset),
      this.usersService.count(),
    ]);
    return toPaginated(data, total, limit, offset);
  }

  async deleteUser(id: string) {
    const result = await this.usersService.remove(id);
    return result.message || 'User deleted successfully';
  }

  async findAllLyrics(
    query: AdminLyricQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const isActive =
      query.status === 'inactive'
        ? false
        : query.status === 'active'
          ? true
          : undefined;
    const { data, total } = await this.lyricsService.findAllForAdmin({
      limit,
      offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      isActive,
      source: query.source,
    });
    return toPaginated(data, total, limit, offset);
  }

  /** Deactivates every lyric from one source (takedown by source). */
  deactivateLyricsBySource(source: string) {
    return this.lyricsService.deactivateBySource(source);
  }

  deleteLyric(id: number) {
    return this.lyricsService.remove(id);
  }

  async restoreLyric(id: number) {
    const lyric = await this.lyricsService.findOneIncludingInactive(id);
    if (lyric.isActive) {
      throw new ConflictException(`Lyric with id ${id} is already active`);
    }
    return this.lyricsService.restore(id);
  }

  async importLyrics(
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    dryRun = false,
    user?: { id: string; [key: string]: unknown },
    mode: LyricsImportMode = 'upsert',
  ): Promise<LyricsImportReport> {
    if (!file || !file.buffer) {
      throw new BadRequestException('A CSV or JSON file is required');
    }

    const rawRows = this.parseImportFile(file);
    const report: LyricsImportReport = {
      dryRun,
      mode,
      total: rawRows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      rows: [],
    };

    const seen = new Map<string, number>();
    const valid: Array<{ line: number; dto: CreateLyricDto }> = [];

    for (const { line, data } of rawRows) {
      const dto = plainToInstance(CreateLyricDto, data);
      const validationErrors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: false,
      });

      if (validationErrors.length > 0) {
        report.errors++;
        report.rows.push({
          row: line,
          status: 'error',
          errors: validationErrors.flatMap((e) =>
            Object.values(e.constraints ?? {}),
          ),
        });
        continue;
      }

      const key = `${dto.artist}\u0000${dto.songTitle}`;
      const firstLine = seen.get(key);
      if (firstLine !== undefined) {
        report.errors++;
        report.rows.push({
          row: line,
          status: 'error',
          errors: [
            `Duplicate of row ${firstLine} for (artist, songTitle) in this file`,
          ],
        });
        continue;
      }
      seen.set(key, line);
      valid.push({ line, dto });
    }

    if (valid.length === 0) {
      return report;
    }

    const existingKeys = await this.lyricsService.findExistingKeys(
      valid.map(({ dto }) => ({ artist: dto.artist, songTitle: dto.songTitle })),
    );

    const toCreate: Array<{ line: number; dto: CreateLyricDto }> = [];
    const toUpdate: Array<{ line: number; dto: CreateLyricDto }> = [];

    for (const entry of valid) {
      const key = `${entry.dto.artist}\u0000${entry.dto.songTitle}`;
      const exists = existingKeys.has(key);
      if (exists && mode === 'create-only') {
        report.skipped++;
        report.rows.push({ row: entry.line, status: 'skipped' });
      } else if (exists) {
        toUpdate.push(entry);
      } else {
        toCreate.push(entry);
      }
    }

    if (dryRun) {
      for (const entry of toCreate) {
        report.created++;
        report.rows.push({ row: entry.line, status: 'created' });
      }
      for (const entry of toUpdate) {
        report.updated++;
        report.rows.push({ row: entry.line, status: 'updated' });
      }
      report.rows.sort((a, b) => a.row - b.row);
      return report;
    }

    if (toCreate.length > 0 || toUpdate.length > 0) {
      await this.lyricsService.bulkUpsert(
        [...toCreate, ...toUpdate].map(({ dto }) => dto),
        user,
      );
    }

    for (const entry of toCreate) {
      report.created++;
      report.rows.push({ row: entry.line, status: 'created' });
    }
    for (const entry of toUpdate) {
      report.updated++;
      report.rows.push({ row: entry.line, status: 'updated' });
    }
    report.rows.sort((a, b) => a.row - b.row);

    return report;
  }

  private parseImportFile(file: {
    buffer: Buffer;
    originalname?: string;
    mimetype?: string;
  }): ParsedImportRow[] {
    const isJson =
      file.mimetype === 'application/json' ||
      (file.originalname ?? '').toLowerCase().endsWith('.json');

    if (isJson) {
      const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new BadRequestException('Invalid JSON file');
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((data, index) => ({
        line: index + 1,
        data: data as Record<string, unknown>,
      }));
    }

    let records: Array<Record<string, unknown>>;
    try {
      records = parse(file.buffer, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('Invalid CSV file');
    }

    return records.map((data, index) => ({ line: index + 2, data }));
  }
}
