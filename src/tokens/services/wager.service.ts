import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wager } from '../entities/wager.entity';
import { CreateWagerDto } from '../dto/create-wager.dto';
import { DomainEvents } from '../../realtime/domain-events';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Not, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { User } from '../../users/entities/user.entity';
import {
  EscrowContext,
  ITokenService,
  SettlementStatus,
  TOKEN_SERVICE,
  TokenTransactionResult,
} from '../interfaces/token.interface';
import {
  Stroops,
  assertPositiveStroops,
  fromStroops,
  multiplyStroops,
} from '../../stellar/amount.util';
import type { UnsignedTransaction } from '../../stellar/services/stellar-rpc.service';
import { sanitizeForDisplay } from '../../common/utils/sanitize.util';
import { InFlightSettlementTracker } from './in-flight-settlement.tracker';
import {
  RealtimeEvent,
  WagerStakedPayload,
} from '../../realtime/realtime.events';

export type WagerTransitionResult =
  | { ok: true; wager: Wager }
  | { ok: false; reason: 'not_found' | 'conflict' };

@Injectable()
export class WagerService {
  private readonly logger = new Logger(WagerService.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
    private readonly configService: ConfigService,
    private readonly settlementTracker: InFlightSettlementTracker,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async create(dto: CreateWagerDto): Promise<Wager> {
    const wager = this.wagerRepository.create(dto);
    return this.wagerRepository.save(wager);
  }

  async findById(id: string): Promise<Wager> {
    const wager = await this.wagerRepository.findOne({ where: { id } });
    if (!wager) {
      throw new NotFoundException(`Wager ${id} not found`);
    }
    return wager;
  }

  /**
   * Conditionally transitions a wager to `staked` using a single UPDATE so
   * concurrent callers cannot double-stake. Emits `wager.staked` after commit.
   */
  async stake(id: string): Promise<WagerTransitionResult> {
    return this.transition(id, 'pending', 'staked', 'wager.staked');
  async confirmStake(
    sessionId: string,
    userId: string,
    signedXdr: string,
  ): Promise<WagerResult> {
    let wager = await this.requireWager(sessionId);

    if (wager.status !== WagerStatus.AWAITING_STAKES) {
      return {
        success: false,
        wager,
        message: `This wager is not awaiting stakes (status: ${wager.status})`,
      };
    }

    if (userId !== wager.playerAId && userId !== wager.playerBId) {
      throw new BadRequestException('You are not a player in this wager');
    }

    const isPlayerA = userId === wager.playerAId;
    const expectedHash = isPlayerA
      ? wager.playerALatestStakeHash
      : wager.playerBLatestStakeHash;

    // The backend checks the envelope against the latest hash offered to
    // this player before submitting anything, so a superseded transaction is
    // rejected (400) without ever reaching the network.
    const result = await this.tokenService.confirmStake(
      userId,
      signedXdr,
      this.contextFor(wager),
      expectedHash,
    );

    // Only a confirmed stake counts. A failed or still-pending transaction
    // still has a hash; keep it aside for reconciliation instead.
    if (result.status !== SettlementStatus.CONFIRMED) {
      if (result.txHash) {
        if (isPlayerA) wager.playerAPendingStakeHash = result.txHash;
        else wager.playerBPendingStakeHash = result.txHash;
        wager = await this.wagerRepository.save(wager);
      }

      return {
        success: false,
        wager,
        message: result.message || 'The stake transaction did not confirm',
      };
    }

    if (isPlayerA) {
      wager.playerAStakeTxHash = result.txHash ?? null;
      wager.playerAPendingStakeHash = null;
    } else {
      wager.playerBStakeTxHash = result.txHash ?? null;
      wager.playerBPendingStakeHash = null;
    }

    wager.resultMessage =
      'Stake confirmed. Waiting for your opponent to sign theirs.';
    wager = await this.wagerRepository.save(wager);

    // Move to STAKED only once both stakes are recorded. The conditional
    // update makes the transition happen exactly once even when both players
    // confirm concurrently.
    const resultMessage = `Wager on! Pot: ${fromStroops(wager.totalPotStroops)} LYRIC`;
    const transition = await this.wagerRepository.update(
      {
        id: wager.id,
        status: WagerStatus.AWAITING_STAKES,
        playerAStakeTxHash: Not(IsNull()),
        playerBStakeTxHash: Not(IsNull()),
      },
      { status: WagerStatus.STAKED, stakeDeadline: null, resultMessage },
    );

    if (transition.affected) {
      wager.status = WagerStatus.STAKED;
      wager.stakeDeadline = null;
      wager.resultMessage = resultMessage;
      this.eventEmitter?.emit(RealtimeEvent.WAGER_STAKED, {
        wagerId: wager.id,
        sessionId: wager.sessionId,
        playerAId: wager.playerAId,
        playerBId: wager.playerBId,
        stakeStroops: wager.stakeStroops,
        totalPotStroops: wager.totalPotStroops,
      } satisfies WagerStakedPayload);
    }

    return { success: true, wager, message: wager.resultMessage };
  }

  /**
   * Conditionally transitions a wager to `settled` using a single UPDATE so
   * concurrent callers cannot double-settle. Emits `wager.settled` after commit.
   */
  async settle(id: string): Promise<WagerTransitionResult> {
    return this.transition(id, 'staked', 'settled', 'wager.settled');
  }

  private async transition(
    id: string,
    from: Wager['status'],
    to: Wager['status'],
    eventName: string,
  ): Promise<WagerTransitionResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(Wager)
        .set({ status: to })
        .where('id = :id', { id })
        .andWhere('status = :from', { from })
        .execute();

      if (!result.affected) {
        await queryRunner.rollbackTransaction();
        const exists = await this.wagerRepository.findOne({ where: { id } });
        return { ok: false, reason: exists ? 'conflict' : 'not_found' };
      }

      const wager = await queryRunner.manager.findOne(Wager, { where: { id } });
      if (!wager) {
        await queryRunner.rollbackTransaction();
        return { ok: false, reason: 'not_found' };
      }

      DomainEvents.queue(queryRunner, eventName, {
        id: wager.id,
        status: wager.status,
        amount: wager.amount,
      });

      await queryRunner.commitTransaction();
      DomainEvents.flush(queryRunner);

      return { ok: true, wager };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to transition wager ${id} to ${to}`, error as Error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
