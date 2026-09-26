import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { GameSession, GameSessionStatus } from '../../game-sessions/entities/game-session.entity';
import { WagerService } from './wager.service';

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
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async refundExpiredWagers(): Promise<void> {
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
      await this.refundOne(wager);
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

      await this.gameSessionRepository.update(
        { id: wager.sessionId },
        { status: GameSessionStatus.ABANDONED },
      );

      // Notifying both players belongs to the in-app notification system
      // (issue #168); until that lands, this is the operator-visible record
      // that it happened.
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
