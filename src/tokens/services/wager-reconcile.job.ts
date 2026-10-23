import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Counter, Gauge } from 'prom-client';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { WagerService } from './wager.service';

/** Runs an asynchronous task inside a fresh OpenTelemetry root span linked to the target wager. */
export async function runWithRootSpan<T>(
  spanName: string,
  attributes: Record<string, any>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const api = require('@opentelemetry/api');
    const tracer = api.trace.getTracer('wager-jobs');
    const rootContext = api.ROOT_CONTEXT;
    // Each job run gets a fresh root span (no parent) so scheduled runs are
    // independent traces; the wager is linked via attributes above.
    return await api.context.with(rootContext, () => {
      return tracer.startActiveSpan(spanName, { attributes }, async (span: any) => {
        try {
          const res = await fn();
          span.setStatus?.({ code: 1 });
          return res;
        } catch (error) {
          span.recordException?.(error);
          span.setStatus?.({ code: 2, message: (error as Error).message });
          throw error;
        } finally {
          span.end();
        }
      });
    });
  } catch {
    return fn();
  }
}

/** Arbitrary constant key for the Postgres advisory lock guarding the sweep. */
export const WAGER_RECONCILE_LOCK_KEY = 7_139_001;

/**
 * Reconciles wagers stuck in `SETTLING` against the chain without an operator.
 *
 * A Postgres advisory lock ensures only one instance sweeps at a time. Failed
 * attempts back off exponentially, and after `WAGER_RECONCILE_MAX_ATTEMPTS`
 * the wager is moved to `FAILED` and an error is logged as the alert.
 *
 * Attempt counters are held in memory: a restart resets them, which only
 * delays the `FAILED` transition and never causes a wrong settlement.
 */
@Injectable()
export class WagerReconcileJob {
  private readonly logger = new Logger(WagerReconcileJob.name);
  private readonly attempts = new Map<
    string,
    { count: number; nextAt: number }
  >();

  /** Number of wagers abandoned by reconciliation (moved to FAILED). */
  private readonly reconcileGiveups = new Counter({
    name: 'lyricsflip_reconcile_giveups_total',
    help: 'Wagers abandoned by reconciliation and moved to FAILED',
  });

  /** Age in seconds of the oldest wager still stuck in SETTLING. */
  private readonly oldestSettlingAge = new Gauge({
    name: 'lyricsflip_oldest_settling_wager_age_seconds',
    help: 'Age in seconds of the oldest wager still in SETTLING status',
  });

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    private readonly wagerService: WagerService,
    private readonly dataSource: DataSource,
  ) {}

  private envInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const rows: Array<{ locked: boolean }> = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [WAGER_RECONCILE_LOCK_KEY],
      );

      if (!rows[0]?.locked) {
        return; // another instance is sweeping
      }

      try {
        await this.reconcileStuckWagers();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [
          WAGER_RECONCILE_LOCK_KEY,
        ]);
      }
    } catch (error) {
      this.logger.error('Wager reconciliation sweep failed', (error as Error).stack);
    } finally {
      await runner.release();
    }
  }

  async reconcileStuckWagers(): Promise<void> {
    const minAgeMs = this.envInt('WAGER_RECONCILE_MIN_AGE_SECONDS', 120) * 1000;
    const maxAttempts = this.envInt('WAGER_RECONCILE_MAX_ATTEMPTS', 8);
    const baseDelayMs = this.envInt('WAGER_RECONCILE_BASE_DELAY_SECONDS', 60) * 1000;

    const stuck = await this.wagerRepository.find({
      where: {
        status: WagerStatus.SETTLING,
        updatedAt: LessThan(new Date(Date.now() - minAgeMs)),
      },
    });

    this.oldestSettlingAge.set(this.computeOldestSettlingAgeSeconds(stuck));

    for (const wager of stuck) {
      const state = this.attempts.get(wager.id) ?? { count: 0, nextAt: 0 };
      if (Date.now() < state.nextAt) continue;

      await runWithRootSpan(
        'job.wager_reconcile.run',
        {
          'wager.id': wager.id,
          'wager_id': wager.id,
          'session.id': wager.sessionId,
          'session_id': wager.sessionId,
          'wager.linked_span': 'job.wager_reconcile.run',
        },
        async () => {
          try {
            const result = await this.wagerService.reconcileWager(wager.sessionId);
            if (result.success) {
              this.attempts.delete(wager.id);
              this.logger.log(`Wager ${wager.id} reconciled: ${result.message}`);
              return;
            }
          } catch (error) {
            this.logger.warn(
              `Reconcile of wager ${wager.id} threw: ${(error as Error).message}`,
            );
          }

          state.count += 1;
          state.nextAt = Date.now() + baseDelayMs * 2 ** (state.count - 1);
          this.attempts.set(wager.id, state);

          if (state.count >= maxAttempts) {
            await this.wagerRepository.update(
              { id: wager.id, status: WagerStatus.SETTLING },
              {
                status: WagerStatus.FAILED,
                resultMessage: `Gave up reconciling after ${state.count} attempts; needs operator review`,
              },
            );
            this.attempts.delete(wager.id);
            this.reconcileGiveups.inc();
            this.logger.error(
              `ALERT: wager ${wager.id} (session ${wager.sessionId}) moved to FAILED after ${state.count} reconcile attempts`,
            );

            // Notify both players that their wager is stuck and needs attention.
            try {
              await this.wagerService.notifyWagerOutcome(wager, 'wager.needs_attention');
            } catch (error) {
              this.logger.warn(
                `Failed to notify players of stuck wager ${wager.id}: ${(error as Error).message}`,
              );
            }
          }
        },
      );
    }
  }

  private computeOldestSettlingAgeSeconds(stuck: Wager[]): number {
    if (stuck.length === 0) return 0;
    const now = Date.now();
    let oldest = now;
    for (const wager of stuck) {
      const updatedAt = wager.updatedAt?.getTime?.() ?? now;
      if (updatedAt < oldest) oldest = updatedAt;
    }
    return Math.max(0, Math.round((now - oldest) / 1000));
  }
}
