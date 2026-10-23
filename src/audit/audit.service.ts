import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  PaginatedResponseDto,
  toPaginated,
} from '../common/dto/paginated-response.dto';
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
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** An audit row plus the actor's username (null for `system` or deleted users). */
export type AuditLogView = AuditLog & { actorUsername: string | null };

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

  private buildQuery(filters: AuditLogFilters) {
    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .leftJoin(User, 'actor', 'actor.id::text = log.actorId')
      .addSelect('actor.username', 'actorUsername')
      .orderBy('log.timestamp', 'DESC');

    if (filters.actorId)
      qb.andWhere('log.actorId = :actorId', { actorId: filters.actorId });
    if (filters.action)
      qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.targetType)
      qb.andWhere('log.targetType = :targetType', {
        targetType: filters.targetType,
      });
    if (filters.targetId)
      qb.andWhere('log.targetId = :targetId', { targetId: filters.targetId });
    if (filters.from)
      qb.andWhere('log.timestamp >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('log.timestamp <= :to', { to: filters.to });
    return qb;
  }

  private withActor(
    entities: AuditLog[],
    raw: { actorUsername: string | null }[],
  ): AuditLogView[] {
    return entities.map((e, i) =>
      Object.assign(e, { actorUsername: raw[i]?.actorUsername ?? null }),
    );
  }

  async find(
    filters: AuditLogFilters,
  ): Promise<PaginatedResponseDto<AuditLogView>> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const qb = this.buildQuery(filters).limit(limit).offset(offset);
    const [{ entities, raw }, total] = await Promise.all([
      qb.getRawAndEntities(),
      this.buildQuery(filters).getCount(),
    ]);
    return toPaginated(this.withActor(entities, raw), total, limit, offset);
  }

  /** Streams every matching row (newest first) in batches, without loading them all. */
  async *iterate(
    filters: AuditLogFilters,
    batchSize = 500,
  ): AsyncGenerator<AuditLogView> {
    for (let offset = 0; ; offset += batchSize) {
      const { entities, raw } = await this.buildQuery(filters)
        .limit(batchSize)
        .offset(offset)
        .getRawAndEntities();
      for (const row of this.withActor(entities, raw)) yield row;
      if (entities.length < batchSize) return;
    }
  }
}
