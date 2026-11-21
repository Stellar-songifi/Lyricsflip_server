import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { GameSession, GameSessionStatus } from '../../game-sessions/entities/game-session.entity';
import { WagerService } from './wager.service';
import { JobLockService } from '../../jobs/job-lock.service';
import { runWithRootSpan } from './wager-reconcile.job';

/**
 * Refunds wagers whose pot has been open too long with at least one player
 * never having staked.
 *
 * Without this sweep, a wager where one player stakes and the other never
 * signs stays `AWAITING_STAKES` forever: the pot stays `Open` on-chain with
 * one stake locked in it, and the only way out was an operator calling
 * refund code by hand.
 *
 * Idempotent by construction: each pass only selects wagers still
 * `AWAITING_STAKES`, and {@link WagerService.resolveWagerAsDraw} moves a
 * wager out of that status as its very first step (to `SETTLING`, then
 * `REFUNDED` or `FAILED`), so a wager this run picks up is never picked up by
 * a run that overlaps it.
 *
 * Runs under a Postgres advisory lock via {@link JobLockService} so that with
 * multiple instances only one of them performs the sweep per tick.
 */
@Injectable()
export class WagerRefundJob {
  private readonly logger = new Logger(WagerRefundJob.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    @InjectRepository(GameSession)
    private readonly gameSessionRepository: Repository<GameSession>,
    private readonly wagerService: WagerService,
    private readonly jobLockService: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async refundExpiredWagers(): Promise<void> {
    await this.jobLockService.runExclusive('wager-refund', () =>
      this.sweepExpiredWagers(),
    );
  }

  private async sweepExpiredWagers(): Promise<void> {
    const expired = await this.wagerRepository.find({
      where: {
        status: WagerStatus.AWAITING_STAKES,
        stakeDeadline: LessThan(new Date()),
      },
    });

    if (expired.length === 0) {
      return;
    }

    this.logger.log(
      `Refunding ${expired.length} wager(s) past their stake deadline`,
    );

    for (const wager of expired) {
      await runWithRootSpan(
        'job.wager_refund.run',
        {
          'wager.id': wager.id,
          'wager_id': wager.id,
          'session.id': wager.sessionId,
          'session_id': wager.sessionId,
        },
        () => this.refundOne(wager),
      );
    }
  }

  private async refundOne(wager: Wager): Promise<void> {
    try {
      const result = await this.wagerService.resolveWagerAsDraw(
        wager.sessionId,
      );

      if (!result.success) {
        this.logger.warn(
          `Automatic refund for wager ${wager.id} did not complete: ${result.message}`,
        );
        return;
      }

      // resolveWagerAsDraw is idempotent: if a concurrent run already moved
      // this wager out of AWAITING_STAKES, it returns success without a
      // second on-chain refund. Only mark the session abandoned once the
      // wager has actually reached a terminal refunded state.
      const settled = await this.wagerRepository.findOne({
        where: { id: wager.id },
      });

      if (settled && settled.status !== WagerStatus.REFUNDED) {
        this.logger.warn(
          `Wager ${wager.id} did not reach REFUNDED (status ${settled.status}); ` +
            `leaving session ${wager.sessionId} untouched.`,
        );
        return;
      }

      await this.gameSessionRepository.update(
        { id: wager.sessionId },
        { status: GameSessionStatus.ABANDONED },
      );

      // WagerService.resolveWagerAsDraw emits the terminal `wager.refunded`
      // (or `wager.failed`) domain event, which the notifications listener
      // turns into a stored notification for both players and a realtime
      // push to each user's room. This log stays as the operator-visible
      // record of the automatic sweep.
      this.logger.log(
        `Wager ${wager.id} (session ${wager.sessionId}) refunded automatically; ` +
          `players ${wager.playerAId} and ${wager.playerBId} never both staked ` +
          `before the deadline.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to refund expired wager ${wager.id}`,
        (error as Error).stack,
      );
    }
  }
}