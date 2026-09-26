import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface RecordAuditEntryInput {
  actorId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AuditLogFilters {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Writes and reads audit_log rows.
 *
 * There is deliberately no `update` or `delete` method: rows are append-only,
 * and `AuditController` only ever exposes `find`, so the only way to remove
 * an audit row through this app is direct database access.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async record(entry: RecordAuditEntryInput): Promise<AuditLog> {
    const row = this.auditLogRepository.create({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      payload: entry.payload ?? null,
      ip: entry.ip ?? null,
    });

    return this.auditLogRepository.save(row);
  }

  async find(filters: AuditLogFilters): Promise<{ data: AuditLog[]; total: number }> {
    const where: FindOptionsWhere<AuditLog> = {};

    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.targetId) where.targetId = filters.targetId;

    const [data, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      take: Math.min(filters.limit ?? 50, 200),
      skip: filters.offset ?? 0,
    });

    return { data, total };
  }
}
