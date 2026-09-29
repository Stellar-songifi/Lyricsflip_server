import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import { MetricsService } from './metrics.service';

/** Payload emitted on the 'wager.settled' event. */
export interface WagerSettledMetricPayload {
  outcome: 'won' | 'refunded' | 'failed';
}

/**
 * Keeps wager-related Prometheus metrics in sync with the database.
 *
 * - Polls the `wagers` table every 30 s and refreshes the gauge for every
 *   WagerStatus value (zeroing statuses that have no rows so old data does not
 *   linger).
 * - Listens for the internal `wager.settled` event and increments the
 *   settlement-outcome counter immediately, without waiting for the next poll.
 */
@Injectable()
export class WagerMetricsService implements OnModuleInit {
  private readonly logger = new Logger(WagerMetricsService.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Populate gauges at startup so the first scrape shows real values.
    await this.refreshWagerGauges();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async refreshWagerGauges(): Promise<void> {
    try {
      const rows = await this.wagerRepository
        .createQueryBuilder('wager')
        .select('wager.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('wager.status')
        .getRawMany<{ status: string; count: string }>();

      // Reset every known status to 0 before applying the query results so
      // that a status with no rows drops to 0 instead of holding a stale value.
      for (const status of Object.values(WagerStatus)) {
        this.metricsService.wagersByStatus.set({ status }, 0);
      }

      for (const row of rows) {
        this.metricsService.wagersByStatus.set(
          { status: row.status },
          parseInt(row.count, 10),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to refresh wager gauges: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Increments the settlement-outcome counter whenever a wager is finalised.
   *
   * Services that resolve a wager should emit 'wager.settled' with the outcome
   * so this counter stays accurate between gauge polls.
   */
  @OnEvent('wager.settled')
  onWagerSettled(payload: WagerSettledMetricPayload): void {
    this.metricsService.settlementOutcomes.inc({ outcome: payload.outcome });
  }
}
