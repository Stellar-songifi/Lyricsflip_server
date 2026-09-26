import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { WagerService } from './wager.service';

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

    for (const wager of stuck) {
      const state = this.attempts.get(wager.id) ?? { count: 0, nextAt: 0 };
      if (Date.now() < state.nextAt) continue;

      try {
        const result = await this.wagerService.reconcileWager(wager.sessionId);
        if (result.success) {
          this.attempts.delete(wager.id);
          this.logger.log(`Wager ${wager.id} reconciled: ${result.message}`);
          continue;
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
        this.logger.error(
          `ALERT: wager ${wager.id} (session ${wager.sessionId}) moved to FAILED after ${state.count} reconcile attempts`,
        );
      }
    }
  }
}
