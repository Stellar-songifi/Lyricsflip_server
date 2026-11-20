import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
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

export interface CreateWagerDto {
  sessionId: string;
  playerAId: string;
  playerBId: string;
  /** Amount each player stakes, in token base units (stroops). */
  stake: Stroops;
}

export interface WagerResult {
  success: boolean;
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

/**
 * Coordinates a wager across the database and the Stellar network.
 *
 * The ordering rule this service exists to enforce: **no network call happens
 * inside a database transaction.** A Postgres rollback cannot un-submit a
 * Stellar transaction, so wrapping the two together produces a database that
 * disagrees with the ledger — the wager looks refunded while the tokens sit in
 * escrow, or looks unpaid while the winner has already been paid.
 *
 * Instead each step commits its own intent first, performs the network call
 * outside any transaction, then commits the observed outcome. A crash between
 * those points leaves a row in `SETTLING` carrying a transaction hash, which
 * {@link reconcileWager} can resolve against the chain.
 */
@Injectable()
export class WagerService {
  private readonly logger = new Logger(WagerService.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
    private readonly configService: ConfigService,
    private readonly settlementTracker: InFlightSettlementTracker,
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
          message: `${sanitizeForDisplay(playerA.username)} has insufficient LYRIC for this wager (${fromStroops(stake)} required)`,
        };
      }

      if (!playerBFunded) {
        return {
          success: false,
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
  }

  /**
   * Stakes player two, who has just accepted the invitation.
   *
   * This is the only place player two's funds are moved from. In
   * non-custodial mode it returns their unsigned transaction instead, to be
   * submitted through {@link confirmStake}.
   */
  async acceptWager(sessionId: string, userId: string): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (userId !== wager.playerBId) {
      throw new BadRequestException('Only the invited player can accept');
    }

    if (
      wager.status !== WagerStatus.AWAITING_STAKES ||
      wager.playerBStakeTxHash
    ) {
      return {
        success: false,
        wager,
        message: `This wager is not awaiting your stake (status: ${wager.status})`,
      };
    }

    const stakeB = await this.tokenService.stakeTokens(
      userId,
      this.contextFor(wager),
    );

    if (stakeB.status === SettlementStatus.PENDING_SIGNATURE) {
      return {
        success: true,
        wager,
        message: stakeB.message,
        pendingSignatures: [
          {
            userId,
            transaction: stakeB.unsignedTransaction as UnsignedTransaction,
          },
        ],
      };
    }

    if (!stakeB.success) {
      return { success: false, wager, message: stakeB.message };
    }

    wager.playerBStakeTxHash = stakeB.txHash ?? null;

    if (wager.playerAStakeTxHash) {
      wager.status = WagerStatus.STAKED;
      wager.resultMessage = `Wager on! Pot: ${fromStroops(wager.totalPotStroops)} LYRIC`;
    } else {
      wager.resultMessage =
        'Stake confirmed. Waiting for your opponent to sign theirs.';
    }

    const saved = await this.wagerRepository.save(wager);

    return { success: true, wager: saved, message: saved.resultMessage };
  }

  /**
   * Submits a stake transaction a player signed in their wallet.
   *
   * Once both players' stakes are confirmed the wager moves to `STAKED` and the
   * match can be played.
   */
  async confirmStake(
    sessionId: string,
    userId: string,
    signedXdr: string,
  ): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

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

    const result = await this.tokenService.confirmStake(
      userId,
      signedXdr,
      this.contextFor(wager),
    );

    // The hash the wallet actually signed has to match the most recent one
    // this wager offered — otherwise it is a stake transaction that expired
    // and was superseded by a fresh one from requestFreshStakeTransaction,
    // and accepting it anyway would confirm a stake against a transaction
    // this wager no longer expects.
    const expectedHash =
      userId === wager.playerAId
        ? wager.playerALatestStakeHash
        : wager.playerBLatestStakeHash;

    if (
      result.success &&
      expectedHash &&
      result.txHash &&
      result.txHash !== expectedHash
    ) {
      return {
        success: false,
        wager,
        message:
          'This stake transaction has expired. Request a new one via ' +
          'POST /game-sessions/:id/stake/transaction and sign that instead.',
      };
    }

    if (userId === wager.playerAId) {
      wager.playerAStakeTxHash = result.txHash ?? wager.playerAStakeTxHash;
    } else {
      wager.playerBStakeTxHash = result.txHash ?? wager.playerBStakeTxHash;
    }

    const saved = await this.wagerRepository.save(wager);

    return { success: result.success, wager: saved, message: result.message };
  }

  /**
   * Issues a fresh stake transaction for a player whose previous one expired.
   *
   * Only the hash of the most recently issued transaction is accepted by
   * {@link confirmStake}, so a superseded transaction cannot be replayed.
   */
  async requestFreshStakeTransaction(
    sessionId: string,
    userId: string,
  ): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

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

    const alreadyStaked =
      userId === wager.playerAId
        ? wager.playerAStakeTxHash
        : wager.playerBStakeTxHash;

    if (alreadyStaked) {
      return {
        success: false,
        wager,
        message: 'Your stake is already confirmed',
      };
    }

    const stake = await this.tokenService.stakeTokens(
      userId,
      this.contextFor(wager),
    );

    if (stake.status === SettlementStatus.PENDING_SIGNATURE) {
      if (userId === wager.playerAId) {
        wager.playerALatestStakeHash =
          stake.unsignedTransaction?.hash ?? null;
      } else {
        wager.playerBLatestStakeHash =
          stake.unsignedTransaction?.hash ?? null;
      }
      wager.stakeDeadline = new Date(Date.now() + this.stakeDeadlineMs);
      const saved = await this.wagerRepository.save(wager);

      return {
        success: true,
        wager: saved,
        message: stake.message,
        pendingSignatures: [
          {
            userId,
            transaction: stake.unsignedTransaction as UnsignedTransaction,
          },
        ],
      };
    }

    if (!stake.success) {
      return { success: false, wager, message: stake.message };
    }

    if (userId === wager.playerAId) {
      wager.playerAStakeTxHash = stake.txHash ?? null;
    } else {
      wager.playerBStakeTxHash = stake.txHash ?? null;
    }

    if (wager.playerAStakeTxHash && wager.playerBStakeTxHash) {
      wager.status = WagerStatus.STAKED;
      wager.resultMessage = `Wager on! Pot: ${fromStroops(wager.totalPotStroops)} LYRIC`;
    }

    const saved = await this.wagerRepository.save(wager);

    return { success: true, wager: saved, message: saved.resultMessage };
  }

  /**
   * Pays the pot to `winnerId` and records the outcome.
   *
   * The wager is moved to `SETTLING` and committed before the payout is
   * submitted, so a crash mid-payout leaves a row carrying the transaction
   * hash for {@link reconcileWager} to resolve.
   */
  async resolveWagerWithWinner(
    sessionId: string,
    winnerId: string,
  ): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (wager.status === WagerStatus.WON || wager.status === WagerStatus.DRAW) {
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

    if (wager.status === WagerStatus.DRAW || wager.status === WagerStatus.WON) {
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

    try {
      wager.status = WagerStatus.SETTLING;
      wager.settledAt = new Date();
      wager = await this.wagerRepository.save(wager);

      const refund = await this.tokenService.refundEscrow(
        this.contextFor(wager),
      );

      wager.settlementTxHash = refund.txHash ?? null;

      if (refund.status === SettlementStatus.PENDING_SIGNATURE) {
        wager.resultMessage =
          'Refund transaction is awaiting a wallet signature.';
        wager = await this.wagerRepository.save(wager);

        return {
          success: true,
          wager,
          message: wager.resultMessage,
          pendingSignatures: refund.unsignedTransaction
            ? [
                {
                  userId: wager.playerAId,
                  transaction: refund.unsignedTransaction,
                },
              ]
            : undefined,
        };
      }

      if (!refund.success) {
        wager.status = WagerStatus.STAKED;
        wager.resultMessage = `Refund failed: ${refund.message}`;
        wager = await this.wagerRepository.save(wager);

        return { success: false, wager, message: wager.resultMessage };
      }

      wager.status = WagerStatus.DRAW;
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

    wager.status = wager.winnerId ? WagerStatus.WON : WagerStatus.DRAW;
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
    return this.wagerRepository.findOne({ where: { sessionId } });
  }

  async getUserWagers(userId: string): Promise<Wager[]> {
    return this.wagerRepository.find({
      where: [{ playerAId: userId }, { playerBId: userId }],
      order: { createdAt: 'DESC' },
    });
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

  private async requireUser(userId: string, label: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`${label} not found`);
    }
    return user;
  }

  private async requireWager(sessionId: string): Promise<Wager> {
    const wager = await this.wagerRepository.findOne({
      where: { sessionId },
    });
    if (!wager) {
      throw new NotFoundException(`No wager found for session ${sessionId}`);
    }
    return wager;
  }

  private contextFor(wager: Wager): EscrowContext {
    return {
      sessionId: wager.sessionId,
      playerAId: wager.playerAId,
      playerBId: wager.playerBId,
      stake: wager.stakeStroops,
    };
  }
}
