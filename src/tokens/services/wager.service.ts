import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  ) {}

  /**
   * Opens an escrow pot for a session and stakes both players into it.
   *
   * In non-custodial mode this returns before the stakes have landed: the
   * result carries one unsigned transaction per player, and the wager stays in
   * `AWAITING_STAKES` until {@link confirmStake} has been called for both.
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

      // Step 3 — stake each player. Sequential rather than concurrent so that a
      // failure on the second stake has an unambiguous first-stake outcome to
      // roll back from.
      const stakeA = await this.tokenService.stakeTokens(playerAId, context);
      const stakeB = await this.tokenService.stakeTokens(playerBId, context);

      wager.playerAStakeTxHash = stakeA.txHash ?? null;
      wager.playerBStakeTxHash = stakeB.txHash ?? null;

      const pendingSignatures = [
        { userId: playerAId, result: stakeA },
        { userId: playerBId, result: stakeB },
      ]
        .filter(
          (entry) => entry.result.status === SettlementStatus.PENDING_SIGNATURE,
        )
        .map((entry) => ({
          userId: entry.userId,
          transaction: entry.result.unsignedTransaction as UnsignedTransaction,
        }));

      if (pendingSignatures.length > 0) {
        for (const entry of pendingSignatures) {
          if (entry.userId === playerAId) {
            wager.playerALatestStakeHash = entry.transaction.hash;
          } else {
            wager.playerBLatestStakeHash = entry.transaction.hash;
          }
        }

        wager.resultMessage =
          'Waiting for players to sign their stake transactions in their wallets.';
        wager = await this.wagerRepository.save(wager);

        return {
          success: true,
          wager,
          message: wager.resultMessage,
          pendingSignatures,
        };
      }

      const failed = [stakeA, stakeB].find((result) => !result.success);

      if (failed) {
        // One stake landed and the other did not. Refunding returns whatever is
        // actually in the pot, so this is safe whether zero or one stake made it.
        const refund = await this.tokenService.refundEscrow(context);

        await this.markFailed(
          wager,
          `Staking failed (${failed.message}). ` +
            (refund.success
              ? 'Any stake that landed has been refunded.'
              : `Refund also failed: ${refund.message}. Needs operator attention.`),
        );

        return { success: false, wager, message: wager.resultMessage };
      }

      wager.status = WagerStatus.STAKED;
      wager.resultMessage = `Wager on! Each player staked ${fromStroops(stake)} LYRIC. Pot: ${fromStroops(wager.totalPotStroops)} LYRIC`;
      wager = await this.wagerRepository.save(wager);

      this.logger.debug(
        `Wager ${wager.id} funded; pot is ${fromStroops(wager.totalPotStroops)} LYRIC`,
      );

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

    if (!result.success) {
      const saved = await this.wagerRepository.save(wager);
      return { success: false, wager: saved, message: result.message };
    }

    // A hash on both sides means both stakes have been submitted and confirmed;
    // until then the wager stays open for the other player's signature.
    const stakedPlayers = [wager.playerAStakeTxHash, wager.playerBStakeTxHash];
    const bothConfirmed = stakedPlayers.every((hash) => Boolean(hash));

    if (bothConfirmed) {
      wager.status = WagerStatus.STAKED;
      wager.resultMessage = `Wager on! Pot: ${fromStroops(wager.totalPotStroops)} LYRIC`;
    }

    const saved = await this.wagerRepository.save(wager);

    return {
      success: true,
      wager: saved,
      message: bothConfirmed
        ? saved.resultMessage
        : 'Stake confirmed. Waiting for your opponent to sign theirs.',
    };
  }

  /**
   * Rebuilds the caller's stake transaction, for when the one they were given
   * has expired — its timeout ran out, or another transaction from that
   * account moved the sequence number the original was built against.
   *
   * Only valid while the wager is `AWAITING_STAKES` and this player has not
   * already staked; the new transaction's hash replaces the old one, so
   * {@link confirmStake} only accepts a signature over the transaction this
   * call just handed out.
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
        message: 'You have already staked; there is nothing to rebuild',
      };
    }

    const result = await this.tokenService.stakeTokens(
      userId,
      this.contextFor(wager),
    );

    if (
      result.status !== SettlementStatus.PENDING_SIGNATURE ||
      !result.unsignedTransaction
    ) {
      return {
        success: false,
        wager,
        message:
          result.message ?? 'Could not build a new stake transaction',
      };
    }

    if (userId === wager.playerAId) {
      wager.playerALatestStakeHash = result.unsignedTransaction.hash;
    } else {
      wager.playerBLatestStakeHash = result.unsignedTransaction.hash;
    }

    const saved = await this.wagerRepository.save(wager);

    return {
      success: true,
      wager: saved,
      message: 'New stake transaction ready to sign.',
      pendingSignatures: [
        { userId, transaction: result.unsignedTransaction },
      ],
    };
  }

  /** Releases the pot to the winner. */
  async resolveWagerWithWinner(
    sessionId: string,
    winnerId: string,
  ): Promise<WagerResult> {
    this.logger.debug(
      `Resolving wager for session ${sessionId}; winner ${winnerId}`,
    );

    try {
      const wager = await this.requireWager(sessionId);

      if (wager.status !== WagerStatus.STAKED) {
        return {
          success: false,
          wager,
          message: `Wager cannot be resolved from status: ${wager.status}`,
        };
      }

      if (winnerId !== wager.playerAId && winnerId !== wager.playerBId) {
        throw new BadRequestException(
          'Winner must be one of the wagering players',
        );
      }

      return await this.settle(
        wager,
        () =>
          this.tokenService.releaseToWinner(winnerId, this.contextFor(wager)),
        (settled, result) => {
          settled.status = WagerStatus.WON;
          settled.winnerId = winnerId;
          settled.winner =
            winnerId === settled.playerAId ? settled.playerA : settled.playerB;
          settled.resultMessage =
            result.message ??
            `Pot of ${fromStroops(settled.totalPotStroops)} LYRIC released to the winner`;
        },
      );
    } catch (error) {
      this.logger.error(
        `Error resolving wager for session ${sessionId}`,
        (error as Error).stack,
      );
      return {
        success: false,
        message: `Failed to resolve wager: ${(error as Error).message}`,
      };
    }
  }

  /** Refunds a drawn or abandoned match. */
  async resolveWagerAsDraw(sessionId: string): Promise<WagerResult> {
    this.logger.debug(`Refunding wager for session ${sessionId}`);

    try {
      const wager = await this.requireWager(sessionId);

      if (
        wager.status !== WagerStatus.STAKED &&
        wager.status !== WagerStatus.AWAITING_STAKES
      ) {
        return {
          success: false,
          wager,
          message: `Wager cannot be refunded from status: ${wager.status}`,
        };
      }

      return await this.settle(
        wager,
        () => this.tokenService.refundEscrow(this.contextFor(wager)),
        (settled, result) => {
          settled.status = WagerStatus.REFUNDED;
          settled.resultMessage =
            result.message ??
            `Draw! Each player received their ${fromStroops(settled.stakeStroops)} LYRIC back.`;
        },
      );
    } catch (error) {
      this.logger.error(
        `Error refunding wager for session ${sessionId}`,
        (error as Error).stack,
      );
      return {
        success: false,
        message: `Failed to refund wager: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Re-checks a wager left in `SETTLING` against the chain and finalises it.
   *
   * This is the counterpart to never assuming a submission succeeded: something
   * has to come back later and find out. Call it from an operator endpoint or a
   * scheduled sweep over wagers that have been settling for too long.
   */
  async reconcileWager(sessionId: string): Promise<WagerResult> {
    const wager = await this.requireWager(sessionId);

    if (wager.status !== WagerStatus.SETTLING) {
      return {
        success: true,
        wager,
        message: `Nothing to reconcile; wager is ${wager.status}`,
      };
    }

    if (!wager.settlementTxHash) {
      await this.markFailed(
        wager,
        'Wager was left settling with no transaction hash; it never reached the network.',
      );
      return { success: false, wager, message: wager.resultMessage };
    }

    const result = await this.tokenService.reconcile(
      wager.settlementTxHash,
      this.contextFor(wager),
    );

    if (result.status !== SettlementStatus.CONFIRMED) {
      return {
        success: false,
        wager,
        message: result.message ?? 'Settlement still unconfirmed',
      };
    }

    // The winner tells us which way this settlement went: a wager with a winner
    // was a payout, one without was a refund.
    wager.status = wager.winnerId ? WagerStatus.WON : WagerStatus.REFUNDED;
    wager.resolvedAt = new Date();
    wager.settlementLedger = result.ledger
      ? String(result.ledger)
      : wager.settlementLedger;
    wager.resultMessage = result.message ?? 'Settlement confirmed on-chain';

    const saved = await this.wagerRepository.save(wager);

    return { success: true, wager: saved, message: saved.resultMessage };
  }

  /** Gets wager details for a session. */
  async getWagerBySessionId(sessionId: string): Promise<Wager | null> {
    try {
      return await this.wagerRepository.findOne({
        where: { sessionId },
        relations: ['playerA', 'playerB', 'winner'],
      });
    } catch (error) {
      this.logger.error(
        `Error getting wager for session ${sessionId}`,
        (error as Error).stack,
      );
      return null;
    }
  }

  /** Gets all wagers for a user. */
  async getUserWagers(userId: string, limit: number = 10): Promise<Wager[]> {
    try {
      return await this.wagerRepository
        .createQueryBuilder('wager')
        .leftJoinAndSelect('wager.playerA', 'playerA')
        .leftJoinAndSelect('wager.playerB', 'playerB')
        .leftJoinAndSelect('wager.winner', 'winner')
        .where('wager.playerAId = :userId OR wager.playerBId = :userId', {
          userId,
        })
        .orderBy('wager.createdAt', 'DESC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error(
        `Error getting wagers for user ${userId}`,
        (error as Error).stack,
      );
      return [];
    }
  }

  /**
   * Runs one settlement step with the ordering that makes an interrupted
   * payout recoverable:
   *
   * 1. mark the wager `SETTLING` and commit, so a crash is visible;
   * 2. call the network, outside any database transaction;
   * 3. commit whatever actually happened.
   *
   * A result that is neither confirmed nor failed — submitted but unseen —
   * leaves the wager in `SETTLING` with its hash recorded, for reconciliation.
   */
  private async settle(
    wager: Wager,
    perform: () => Promise<TokenTransactionResult>,
    applySuccess: (wager: Wager, result: TokenTransactionResult) => void,
  ): Promise<WagerResult> {
    wager.status = WagerStatus.SETTLING;
    await this.wagerRepository.save(wager);

    const result = await perform();

    wager.settlementTxHash = result.txHash ?? null;

    if (result.status === SettlementStatus.CONFIRMED) {
      applySuccess(wager, result);
      wager.resolvedAt = new Date();
      wager.settlementLedger = result.ledger ? String(result.ledger) : null;

      const saved = await this.wagerRepository.save(wager);
      return { success: true, wager: saved, message: saved.resultMessage };
    }

    if (result.status === SettlementStatus.SUBMITTED) {
      wager.resultMessage =
        result.message ??
        'Settlement submitted; awaiting confirmation from the network.';
      const saved = await this.wagerRepository.save(wager);

      this.logger.warn(
        `Wager ${wager.id} left settling with tx ${wager.settlementTxHash}; reconciliation required`,
      );

      return { success: false, wager: saved, message: saved.resultMessage };
    }

    await this.markFailed(wager, result.message ?? 'Settlement failed');
    return { success: false, wager, message: wager.resultMessage };
  }

  private contextFor(wager: Wager): EscrowContext {
    return {
      sessionId: wager.sessionId,
      playerAId: wager.playerAId,
      playerBId: wager.playerBId,
      stake: wager.stakeStroops,
    };
  }

  private async markFailed(wager: Wager, message: string): Promise<void> {
    wager.status = WagerStatus.FAILED;
    wager.resultMessage = message;
    wager.resolvedAt = new Date();
    await this.wagerRepository.save(wager);
    this.logger.error(`Wager ${wager.id} failed: ${message}`);
  }

  private async requireUser(userId: string, label: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`${label} with ID ${userId} not found`);
    }

    return user;
  }

  private async requireWager(sessionId: string): Promise<Wager> {
    const wager = await this.wagerRepository.findOne({
      where: { sessionId },
      relations: ['playerA', 'playerB'],
    });

    if (!wager) {
      throw new NotFoundException(`Wager for session ${sessionId} not found`);
    }

    return wager;
  }
}
