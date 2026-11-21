import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { toPaginated } from '../common/dto/paginated-response.dto';
import {
  AdminPlayerReportQueryDto,
  CreatePlayerReportDto,
  ResolvePlayerReportDto,
} from './player-report.dto';

export interface PlayerReport {
  id: string;
  reporterId: string;
  playerId: string;
  status: string;
  reason: string;
}

export async function submitPlayerReport(
  manager: EntityManager,
  reporterId: string,
  playerId: string,
  report: CreatePlayerReportDto,
): Promise<void> {
  if (reporterId === playerId) {
    throw new BadRequestException('This interaction is unavailable');
  }
  const [player] = await manager.query<Array<{ id: string }>>(
    'SELECT id FROM users WHERE id = $1 AND "isActive"',
    [playerId],
  );
  if (!player) throw new NotFoundException('Player not found');

  await manager.query(
    `INSERT INTO player_reports ("reporterId", "playerId", reason, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("reporterId", "playerId") WHERE status = 'open' DO NOTHING`,
    [reporterId, playerId, report.reason, report.note ?? null],
  );
}

export async function listPlayerReports(
  manager: EntityManager,
  query: AdminPlayerReportQueryDto,
) {
  const { status = 'open', limit = 20, offset = 0 } = query;
  const [data, counts] = await Promise.all([
    manager.query<PlayerReport[]>(
      `SELECT * FROM player_reports WHERE status = $1
       ORDER BY "createdAt", id LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    ),
    manager.query<Array<{ total: number }>>(
      'SELECT count(*)::int AS total FROM player_reports WHERE status = $1',
      [status],
    ),
  ]);
  return toPaginated(data, counts[0].total, limit, offset);
}

export async function resolvePlayerReport(
  manager: EntityManager,
  id: string,
  adminId: string,
  dto: ResolvePlayerReportDto,
): Promise<PlayerReport> {
  const [report] = await manager.query<PlayerReport[]>(
    `WITH resolved AS (
       UPDATE player_reports SET status = $3, "resolvedBy" = $2,
         resolution = $4, "resolvedAt" = now()
       WHERE id = $1 AND status = 'open' RETURNING *
     )
     SELECT * FROM resolved`,
    [id, adminId, dto.status, dto.resolution ?? null],
  );
  if (!report) throw new NotFoundException('Open report not found');
  return report;
}
