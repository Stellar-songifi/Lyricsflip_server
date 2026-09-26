import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { LyricsService } from 'src/lyrics/lyrics.service';
import { CreateLyricsDto } from 'src/lyrics/dto/create-lyrics.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export interface LyricsImportRowReport {
  row: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  errors?: string[];
}

export interface LyricsImportReport {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: LyricsImportRowReport[];
}

@Injectable()
export class AdminService {
  constructor(
    private usersService: UsersService,
    private lyricsService: LyricsService,
  ) {}

  findAllUsers(limit?: number, offset?: number) {
    return this.usersService.findAll(limit, offset);
  }

  async deleteUser(id: string) {
    const result = await this.usersService.remove(id);
    return result.message || 'User deleted successfully';
  }

  findAllLyrics(limit?: number, offset?: number) {
    return this.lyricsService.findAll(undefined, undefined, limit, offset);
  }

  deleteLyric(id: number) {
    return this.lyricsService.remove(id);
  }

  async importLyrics(
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    dryRun = false,
  ): Promise<LyricsImportReport> {
    if (!file || !file.buffer) {
      throw new BadRequestException('A CSV or JSON file is required');
    }

    const rawRows = this.parseImportFile(file);
    const report: LyricsImportReport = {
      dryRun,
      total: rawRows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      rows: [],
    };

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 1;
      const dto = plainToInstance(CreateLyricsDto, rawRows[i]);
      const validationErrors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: false,
      });

      if (validationErrors.length > 0) {
        report.errors++;
        report.rows.push({
          row: rowNumber,
          status: 'error',
          errors: validationErrors.flatMap((e) =>
            Object.values(e.constraints ?? {}),
          ),
        });
        continue;
      }

      const existing = await this.lyricsService.findByArtistAndTitle(
        dto.artist,
        dto.songTitle,
      );

      if (dryRun) {
        if (existing) {
          report.updated++;
          report.rows.push({ row: rowNumber, status: 'updated' });
        } else {
          report.created++;
          report.rows.push({ row: rowNumber, status: 'created' });
        }
        continue;
      }

      if (existing) {
        await this.lyricsService.update(existing.id, dto);
        report.updated++;
        report.rows.push({ row: rowNumber, status: 'updated' });
      } else {
        await this.lyricsService.create(dto);
        report.created++;
        report.rows.push({ row: rowNumber, status: 'created' });
      }
    }

    if (!dryRun) {
      await this.lyricsService.invalidateCache();
    }

    return report;
  }

  private parseImportFile(file: {
    buffer: Buffer;
    originalname?: string;
    mimetype?: string;
  }): Record<string, unknown>[] {
    const content = file.buffer.toString('utf-8').trim();
    const name = (file.originalname ?? '').toLowerCase();
    const isJson =
      name.endsWith('.json') ||
      file.mimetype === 'application/json' ||
      content.startsWith('[') ||
      content.startsWith('{');

    if (isJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new BadRequestException('Invalid JSON file');
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      );
    }

    return this.parseCsv(content);
  }

  private parseCsv(content: string): Record<string, unknown>[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length === 0) {
      return [];
    }

    const headers = this.splitCsvLine(lines[0]).map((h) => h.trim());
    const rows: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.splitCsvLine(lines[i]);
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? '';
      });
      rows.push(row);
    }

    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }
}
