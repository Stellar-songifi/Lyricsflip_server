import { EscrowContractService } from '../../stellar/services/escrow-contract.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  DEFAULT_PAGE_SIZE,
  toPaginated,
} from '../../common/dto/paginated-response.dto';
import { WagerViewDto } from '../dto/wager-view.dto';
import { ErrorCode } from '../../common/exceptions/domain.exception';
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

export interface CreateWagerDto {
  sessionId: string;
  playerAId: string;
  playerBId: string;
  /** Amount each player stakes, in token base units (stroops). */
  stake: Stroops;
}

export interface WagerResult {
  success: boolean;
  code?: ErrorCode;
  wager?: Wager;
  message?: string;
  /**
   * Transactions the players must sign in their wallets, present when the
   * wager is waiting on non-custodial signatures.
   */
  pendingSignatures?: Array<{
    userId: string;
    transaction: UnsignedTransaction;
  }>;
}
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
    @Optional() private readonly escrow?: EscrowContractService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * How long a wager may sit `AWAITING_STAKES` before {@link WagerRefundJob}
   * refunds it. Configurable via `WAGER_STAKE_DEADLINE_MINUTES`, default 15.
   */
  private get stakeDeadlineMs(): number {
    const minutes =
      this.configService.get<number>('WAGER_STAKE_DEADLINE_MINUTES') ?? 15;
    return minutes * 60_000;
  }

  /**
   * Opens an escrow pot for a session and stakes player one into it.
   *
   * Player two is only staked once they accept, through {@link acceptWager};
   * until then the wager stays in `AWAITING_STAKES`. In non-custodial mode the
   * result carries player one's unsigned transaction instead of a stake.
   */
  async createWager(createWagerDto: CreateWagerDto): Promise<WagerResult> {
    const { sessionId, playerAId, playerBId } = createWagerDto;

    let stake: Stroops;
    try {
      stake = assertPositiveStroops(createWagerDto.stake, 'Stake');
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }

    this.logger.debug(
      `Creating wager for session ${sessionId}: ${playerAId} vs ${playerBId} at ${fromStroops(stake)} LYRIC each`,
    );

    const context: EscrowContext = { sessionId, playerAId, playerBId, stake };

    try {
      const [playerA, playerB] = await Promise.all([
        this.requireUser(playerAId, 'Player A'),
        this.requireUser(playerBId, 'Player B'),
      ]);

      if (playerAId === playerBId) {
        return {
          success: false,
          message: 'A player cannot wager against themselves',
        };
      }

      const existingWager = await this.wagerRepository.findOne({
        where: { sessionId },
      });

      if (existingWager) {
        return {
          success: false,
          message: 'Wager already exists for this session',
        };
      }

      const [playerAFunded, playerBFunded] = await Promise.all([
        this.tokenService.hasSufficientTokens(playerAId, stake),
        this.tokenService.hasSufficientTokens(playerBId, stake),
      ]);

      if (!playerAFunded) {
        return {
          success: false,
          code: ErrorCode.INSUFFICIENT_BALANCE,
          message: `${sanitizeForDisplay(playerA.username)} has insufficient LYRIC for this wager (${fromStroops(stake)} required)`,
        };
      }

      if (!playerBFunded) {
        return {
          success: false,
          code: ErrorCode.INSUFFICIENT_BALANCE,
          message: `${sanitizeForDisplay(playerB.username)} has insufficient LYRIC for this wager (${fromStroops(stake)} required)`,
        };
      }

      // Step 1 — record the intent. Committed before anything touches the
      // network, so a pot that is opened on-chain always has a row pointing at
      // it even if the process dies immediately afterwards.
      let wager = this.wagerRepository.create({
        sessionId,
        playerA,
        playerAId,
        playerB,
        playerBId,
        stakeStroops: stake,
        totalPotStroops: multiplyStroops(stake, 2),
        status: WagerStatus.PENDING,
        settlementMode: this.tokenService.settlementMode,
      });
      wager = await this.wagerRepository.save(wager);

      // Step 2 — open the pot on-chain.
      const escrowResult = await this.tokenService.openEscrow(context);

      if (!escrowResult.success) {
        await this.markFailed(
          wager,
          `Could not open escrow: ${escrowResult.message}`,
        );
        return { success: false, message: escrowResult.message };
      }

      wager.escrowTxHash = escrowResult.txHash ?? null;
      wager.status = WagerStatus.AWAITING_STAKES;
      wager = await this.wagerRepository.save(wager);

      // Step 3 — stake player one only. Player two has not agreed to anything
      // yet, so their funds are not touched until they accept (acceptWager).
      const stakeA = await this.tokenService.stakeTokens(playerAId, context);

      if (stakeA.status === SettlementStatus.PENDING_SIGNATURE) {
        // The stake has not landed yet: remember which transaction we handed
        // out so confirmStake only accepts a signature over this one, and set
        // the deadline so WagerRefundJob can sweep a player who never signs.
        wager.playerALatestStakeHash =
          stakeA.unsignedTransaction?.hash ?? null;
        wager.stakeDeadline = new Date(Date.now() + this.stakeDeadlineMs);
        wager.resultMessage =
          'Sign your stake transaction in your wallet. Player two stakes when they accept.';
        wager = await this.wagerRepository.save(wager);

        return {
          success: true,
          wager,
          message: wager.resultMessage,
          pendingSignatures: [
            {
              userId: playerAId,
              transaction: stakeA.unsignedTransaction as UnsignedTransaction,
            },
          ],
        };
      }

      if (!stakeA.success) {
        const refund = await this.tokenService.refundEscrow(context);

        await this.markFailed(
          wager,
          `Staking failed (${stakeA.message}). ` +
            (refund.success
              ? 'Any stake that landed has been refunded.'
              : `Refund also failed: ${refund.message}. Needs operator attention.`),
        );

        return { success: false, wager, message: wager.resultMessage };
      }

      wager.playerAStakeTxHash = stakeA.txHash ?? null;
      wager.resultMessage = `You staked ${fromStroops(stake)} LYRIC. Waiting for your opponent to accept.`;
      wager = await this.wagerRepository.save(wager);

      return { success: true, wager, message: wager.resultMessage };
    } catch (error) {
      this.logger.error('Error creating wager', (error as Error).stack);
      return {
        success: false,
        message: `Failed to create wager: ${(error as Error).message}`,
      };
    }
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
  async resolveWagerWithWinner(
    sessionId: string,
    winnerId: string,
  ): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (
      wager.status === WagerStatus.WON ||
      wager.status === WagerStatus.REFUNDED
    ) {
      return {
        success: true,
        wager,
        message: 'Wager already settled',
      };
    }

    if (wager.status !== WagerStatus.STAKED) {
      return {
        success: false,
        wager,
        message: `Cannot settle a wager in status ${wager.status}`,
      };
    }

    if (winnerId !== wager.playerAId && winnerId !== wager.playerBId) {
      throw new BadRequestException('Winner is not a player in this wager');
    }

    if (this.settlementTracker.isInFlight(sessionId)) {
      return {
        success: false,
        wager,
        message: 'A settlement for this wager is already in progress',
      };
    }

    this.settlementTracker.begin(sessionId);

    try {
      // Step 1 — commit the intent before touching the network.
      wager.status = WagerStatus.SETTLING;
      wager.winnerId = winnerId;
      wager.settledAt = new Date();
      wager = await this.wagerRepository.save(wager);

      // Step 2 — pay out, outside any database transaction.
      const payout = await this.tokenService.payout(
        winnerId,
        wager.totalPotStroops,
        this.contextFor(wager),
      );

      wager.settlementTxHash = payout.txHash ?? null;

      if (payout.status === SettlementStatus.PENDING_SIGNATURE) {
        // The payout has not landed yet. Leave the wager in SETTLING so
        // reconcileWager can confirm it once the signature is submitted.
        wager.resultMessage =
          'Payout transaction is awaiting a wallet signature.';
        wager = await this.wagerRepository.save(wager);

        return {
          success: true,
          wager,
          message: wager.resultMessage,
          pendingSignatures: payout.unsignedTransaction
            ? [
                {
                  userId: winnerId,
                  transaction: payout.unsignedTransaction,
                },
              ]
            : undefined,
        };
      }

      if (!payout.success) {
        // The payout failed outright. Put the wager back so an operator can
        // retry rather than leaving it stuck in SETTLING.
        wager.status = WagerStatus.STAKED;
        wager.resultMessage = `Payout failed: ${payout.message}`;
        wager = await this.wagerRepository.save(wager);

        return { success: false, wager, message: wager.resultMessage };
      }

      // Step 3 — commit the observed outcome.
      wager.status = WagerStatus.WON;
      wager.resultMessage = `Winner paid ${fromStroops(wager.totalPotStroops)} LYRIC`;
      wager = await this.wagerRepository.save(wager);

      return { success: true, wager, message: wager.resultMessage };
    } finally {
      this.settlementTracker.end(sessionId);
    }
  }

  /**
   * Refunds both stakes and records the match as a draw.
   */
  async resolveWagerAsDraw(sessionId: string): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (
      wager.status === WagerStatus.REFUNDED ||
      wager.status === WagerStatus.WON
    ) {
      return { success: true, wager, message: 'Wager already settled' };
    }

    if (wager.status !== WagerStatus.STAKED) {
      return {
        success: false,
        wager,
        message: `Cannot settle a wager in status ${wager.status}`,
      };
    }

    if (this.settlementTracker.isInFlight(sessionId)) {
      return {
        success: false,
        wager,
        message: 'A settlement for this wager is already in progress',
      };
    }

    this.settlementTracker.begin(sessionId);
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

      wager.status = WagerStatus.REFUNDED;
      wager.resultMessage = 'Draw — both stakes refunded';
      wager = await this.wagerRepository.save(wager);

      return { success: true, wager, message: wager.resultMessage };
    } finally {
      this.settlementTracker.end(sessionId);
    }
  }

  /**
   * Resolves a wager left in `SETTLING` by a crash or an unconfirmed payout.
   *
   * Looks the recorded settlement transaction up on-chain: if it landed the
   * wager is finalised, if it did not the wager is returned to `STAKED` so it
   * can be settled again.
   */
  async reconcileWager(sessionId: string): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (wager.status !== WagerStatus.SETTLING) {
      return {
        success: true,
        wager,
        message: `Nothing to reconcile (status: ${wager.status})`,
      };
    }

    if (!wager.settlementTxHash) {
      // No transaction was ever recorded, so nothing can have landed.
      wager.status = WagerStatus.STAKED;
      wager.resultMessage = 'Settlement was never submitted; retry settlement.';
      const saved = await this.wagerRepository.save(wager);

      return { success: false, wager: saved, message: saved.resultMessage };
    }

    const confirmed = await this.tokenService.isTransactionConfirmed(
      wager.settlementTxHash,
    );

    if (!confirmed) {
      wager.status = WagerStatus.STAKED;
      wager.resultMessage =
        'Settlement transaction did not land; wager returned for retry.';
      const saved = await this.wagerRepository.save(wager);

      return { success: false, wager: saved, message: saved.resultMessage };
    }

    wager.status = wager.winnerId ? WagerStatus.WON : WagerStatus.REFUNDED;
    wager.resultMessage = wager.winnerId
      ? `Winner paid ${fromStroops(wager.totalPotStroops)} LYRIC`
      : 'Draw — both stakes refunded';
    const saved = await this.wagerRepository.save(wager);

    return { success: true, wager: saved, message: saved.resultMessage };
  }

  /**
   * Settles a wager from a match outcome: a winner, or a draw when
   * `winnerId` is null.
   */
  async settle(sessionId: string, winnerId: string | null): Promise<WagerResult> {
    return winnerId
      ? this.resolveWagerWithWinner(sessionId, winnerId)
      : this.resolveWagerAsDraw(sessionId);
  }

  async getWagerBySessionId(sessionId: string): Promise<Wager | null> {
    return this.wagerRepository.findOne({
      where: { sessionId },
      relations: { playerA: true, playerB: true },
      select: { playerA: { username: true }, playerB: { username: true } },
    });
  }

  async getUserWagers(userId: string): Promise<Wager[]> {
    return this.findUserWagers(userId);
  }

  async findUserWagers(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<Wager[]> {
    return this.wagerRepository.find(
      this.historyOptions(userId, limit, offset),
    );
  }

  async getUserWagerPage(userId: string, query: PaginationQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const offset = query.offset ?? 0;
    const [wagers, total] = await this.wagerRepository.findAndCount(
      this.historyOptions(userId, limit, offset),
    );
    const data = await Promise.all(
      wagers.map((wager) => this.toView(wager, userId)),
    );
    return toPaginated(data, total, limit, offset);
  }

  private historyOptions(userId: string, limit?: number, offset?: number) {
    return {
      where: [{ playerAId: userId }, { playerBId: userId }],
      relations: { playerA: true, playerB: true },
      select: { playerA: { username: true }, playerB: { username: true } },
      order: { createdAt: 'DESC', id: 'DESC' } as const,
      take: limit,
      skip: offset,
    };
  }

  async toView(wager: Wager, userId: string): Promise<WagerViewDto> {
    const isStellar = wager.settlementMode === 'stellar';
    const network = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );
    const transaction = (hash: string | null | undefined) =>
      hash
        ? {
            hash,
            explorerUrl:
              isStellar && (network === 'public' || network === 'testnet')
                ? `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(hash)}`
                : null,
          }
        : null;

    const pot =
      isStellar && wager.escrowTxHash
        ? await this.escrow?.getPot(wager.sessionId)
        : null;
    const opponent =
      wager.playerAId === userId
        ? wager.playerB
        : wager.playerBId === userId
          ? wager.playerA
          : null;

    return {
      id: wager.id,
      sessionId: wager.sessionId,
      stake: {
        stroops: wager.stakeStroops,
        display: fromStroops(wager.stakeStroops),
      },
      totalPot: {
        stroops: wager.totalPotStroops,
        display: fromStroops(wager.totalPotStroops),
      },
      opponentUsername: opponent?.username ?? null,
      status: wager.status,
      escrow: transaction(wager.escrowTxHash),
      playerAStake: transaction(wager.playerAStakeTxHash),
      playerBStake: transaction(wager.playerBStakeTxHash),
      settlement: transaction(wager.settlementTxHash),
      claimDeadlineLedger: pot?.deadlineLedger || null,
      stakeDeadline: wager.stakeDeadline ?? null,
    };
  }

  /**
   * Records a wager as failed with an operator-visible reason.
   */
  private async markFailed(wager: Wager, message: string): Promise<Wager> {
    wager.status = WagerStatus.FAILED;
    wager.resultMessage = message;
    this.logger.warn(`Wager ${wager.sessionId} failed: ${message}`);
    return this.wagerRepository.save(wager);
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
