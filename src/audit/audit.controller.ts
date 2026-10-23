import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AuditService } from './audit.service';
import {
  AuditLogExportQueryDto,
  AuditLogQueryDto,
} from './dto/audit-log-query.dto';

@ApiTags('admin')
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit log entries',
    description:
      'Read-only. There is no write or delete endpoint - audit rows can only ' +
      'be created by the actions they describe.',
  })
  find(@Query() query: AuditLogQueryDto) {
    return this.auditService.find(query);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export matching audit log entries as streamed CSV',
  })
  async export(@Query() query: AuditLogExportQueryDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="audit-logs.csv"',
    );
    res.write(CSV_COLUMNS.join(',') + '\n');
    for await (const row of this.auditService.iterate(query)) {
      const line = [
        row.id,
        row.timestamp.toISOString() as string | null,
        row.actorId,
        row.actorUsername,
        row.action,
        row.targetType,
        row.targetId,
        row.ip,
        row.payload ? JSON.stringify(row.payload) : '',
      ]
        .map(csvCell)
        .join(',');
      if (!res.write(line + '\n')) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  }
}

const CSV_COLUMNS = [
  'id',
  'timestamp',
  'actorId',
  'actorUsername',
  'action',
  'targetType',
  'targetId',
  'ip',
  'payload',
];

/** Quotes a CSV cell, and neutralises spreadsheet formula injection. */
function csvCell(value: string | null): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
