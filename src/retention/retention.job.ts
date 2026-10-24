import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

/** Advisory lock key so only one instance runs the retention job at a time. */
const RETENTION_LOCK_KEY = 0x52455431; // "RET1"

/** Rows moved per statement, so no single transaction holds long locks. */
const ARCHIVE_BATCH_SIZE = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enforces the personal-data retention periods in docs/DATA_ARCHIVING.md
 * that are not already enforced elsewhere:
 *
 *   - audit_logs.ip is cleared after AUDIT_IP_RETENTION_DAYS (default 90).
 *     The audit rows themselves are kept.
 *   - game_history rows older than GAME_HISTORY_RETENTION_DAYS (default 730)
 *     are moved to game_history_archive.
 *
 * Notifications (NotificationsService.purgeOldNotifications), game rounds
 * (GameService.pruneGameRounds) and refresh tokens (SessionCleanupJob) have
 * their own jobs.
 */
@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async run(): Promise<void> {
    // Advisory locks belong to a connection, so take and release it on one.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [RETENTION_LOCK_KEY],
      );
      if (!locked) {
        this.logger.debug('Retention job already running elsewhere');
        return;
      }
      try {
        const ips = await this.clearAuditIps();
        const archived = await this.archiveGameHistory();
        this.logger.log(
          `Retention: cleared ${ips} audit IPs, archived ${archived} game_history rows`,
        );
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [RETENTION_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }

  async clearAuditIps(): Promise<number> {
    const cutoff = this.cutoff('AUDIT_IP_RETENTION_DAYS', 90);
    const [, affected] = await this.dataSource.query(
      `UPDATE "audit_logs" SET "ip" = NULL
        WHERE "ip" IS NOT NULL AND "timestamp" < $1`,
      [cutoff],
    );
    return Number(affected ?? 0);
  }

  /**
   * Moves old history to game_history_archive in batches. Each batch is one
   * statement (DELETE ... RETURNING feeding INSERT), so a row is never in
   * both tables or in neither. The archive was created LIKE game_history,
   * so the column lists match.
   */
  async archiveGameHistory(): Promise<number> {
    const cutoff = this.cutoff('GAME_HISTORY_RETENTION_DAYS', 730);
    let total = 0;

    for (;;) {
      const moved: Array<{ id: string }> = await this.dataSource.query(
        `WITH moved AS (
           DELETE FROM "game_history"
            WHERE "id" IN (
              SELECT "id" FROM "game_history"
               WHERE "createdAt" < $1
               LIMIT $2
            )
           RETURNING *
         )
         INSERT INTO "game_history_archive" SELECT * FROM moved
         RETURNING "id"`,
        [cutoff, ARCHIVE_BATCH_SIZE],
      );
      total += moved.length;
      if (moved.length < ARCHIVE_BATCH_SIZE) {
        return total;
      }
    }
  }

  private cutoff(key: string, fallbackDays: number): Date {
    const days = Number(this.config.get<string>(key) ?? fallbackDays);
    const safeDays = Number.isFinite(days) && days > 0 ? days : fallbackDays;
    return new Date(Date.now() - safeDays * DAY_MS);
  }
}
