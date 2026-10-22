import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';

/** Revoked tokens are kept this long so a reuse attempt can still be traced. */
export const REVOKED_SESSION_RETENTION_DAYS = 30;

/**
 * Deletes refresh tokens that can never be used again: those past expiresAt,
 * and those revoked more than REVOKED_SESSION_RETENTION_DAYS ago. Without it
 * every login and every refresh leaves a row behind forever.
 */
@Injectable()
export class SessionCleanupJob {
  private readonly logger = new Logger(SessionCleanupJob.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeDeadSessions(): Promise<number> {
    const revokedCutoff = new Date(
      Date.now() - REVOKED_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('"expiresAt" < now()')
      .orWhere('"revokedAt" < :revokedCutoff', { revokedCutoff })
      .execute();

    const deleted = result.affected ?? 0;
    this.logger.log(`Deleted ${deleted} expired or long-revoked refresh tokens`);
    return deleted;
  }
}
