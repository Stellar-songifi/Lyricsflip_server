import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { GrantMockBalanceMode } from './dto/grant-mock-balance.dto';
import { MockTokenService } from '../tokens/services/mock-token.service';
import { UsersService } from '../users/users.service';
import { LyricsService } from 'src/lyrics/lyrics.service';
import { CreateLyricsDto } from 'src/lyrics/dto/create-lyrics.dto';
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
  meta: { total: number; limit: number; offset: number };
}

interface ParsedImportRow {
  line: number;
  data: Record<string, unknown>;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mockTokenService: MockTokenService,
    private readonly usersService: UsersService,
    private readonly lyricsService: LyricsService,
  ) {}

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
    return { data, meta: { total, limit, offset } };
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
    return { data, meta: { total, limit, offset } };
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
    const valid: Array<{ line: number; dto: CreateLyricsDto }> = [];

    for (const { line, data } of rawRows) {
      const dto = plainToInstance(CreateLyricsDto, data);
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

    const toCreate: Array<{ line: number; dto: CreateLyricsDto }> = [];
    const toUpdate: Array<{ line: number; dto: CreateLyricsDto }> = [];

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
        relax_column_count: true,
        trim: true,
      }) as Array<Record<string, unknown>>;
    } catch (error) {
      throw new BadRequestException(
        `Invalid CSV file: ${(error as Error).message}`,
      );
    }

    return records.map((data, index) => ({ line: index + 1, data }));
  }

  async findAllLyricsLegacy(query: PaginationQueryDto, status?: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.userRepository.manager
      .createQueryBuilder()
      .select('lyric')
      .from('lyrics', 'lyric')
      .skip((page - 1) * limit)
      .take(limit);
    if (status) {
      qb.where('lyric.status = :status', { status });
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
