import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { randomBytes } from 'crypto';
import { User } from '../../users/entities/user.entity';
import {
  EscrowContext,
  ITokenService,
  SettlementStatus,
  TokenTransactionResult,
} from '../interfaces/token.interface';
import {
  Stroops,
  addStroops,
  fromStroops,
  isAtLeast,
  multiplyStroops,
  subtractStroops,
  toBigInt,
} from '../../stellar/amount.util';
import type { SettlementMode } from '../../stellar/stellar.config';

/**
 * In-database settlement backend.
 *
 * It holds the same escrow semantics as the Soroban contract — a pot is opened,
 * funded by both players, then resolved or refunded as a whole — but the funds
 * are rows in Postgres rather than tokens on Stellar. Tests and contributors
 * without a funded testnet account run against this; production runs against
 * {@link StellarTokenService}.
 *
 * Amounts are stroops (1e-7 of a LYRIC), matching the on-chain backend exactly,
 * so switching modes never changes what a wager is worth.
 */
@Injectable()
export class MockTokenService implements ITokenService {
  readonly settlementMode: SettlementMode = 'mock';

  private readonly logger = new Logger(MockTokenService.name);

  /**
   * Pots held by this backend, keyed by session ID.
   *
   * Deliberately in-process: the mock backend is for development and tests, and
   * persisting a fake ledger would invite it into environments that should be
   * using the real contract.
   */
  private readonly pots = new Map<
    string,
    { stake: Stroops; fundedA: boolean; fundedB: boolean; settled: boolean }
  >();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async openEscrow(context: EscrowContext): Promise<TokenTransactionResult> {
    if (this.pots.has(context.sessionId)) {
      return this.failure(
        `A pot already exists for session ${context.sessionId}`,
      );
    }

    this.pots.set(context.sessionId, {
      stake: context.stake,
      fundedA: false,
      fundedB: false,
      settled: false,
    });

    return {
      success: true,
      status: SettlementStatus.CONFIRMED,
      txHash: this.fakeTxHash(),
      message: `Escrow opened for ${fromStroops(context.stake)} LYRIC per player`,
    };
  }

  async stakeTokens(
    userId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    const pot = this.pots.get(context.sessionId);

    if (!pot) {
      return this.failure(`No pot open for session ${context.sessionId}`);
    }

    if (pot.settled) {
      return this.failure('This pot has already been settled');
    }

    const isPlayerA = userId === context.playerAId;
    const isPlayerB = userId === context.playerBId;

    if (!isPlayerA && !isPlayerB) {
      return this.failure('User is not a player in this wager');
    }

    if ((isPlayerA && pot.fundedA) || (isPlayerB && pot.fundedB)) {
      return this.failure('This player has already staked');
    }

    try {
      const newBalance = await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          const user = await this.lockUser(manager, userId);

          if (!isAtLeast(user.mockBalance, context.stake)) {
            throw new InsufficientBalanceError(user.mockBalance, context.stake);
          }

          user.mockBalance = subtractStroops(user.mockBalance, context.stake);
          await manager.save(user);

          return user.mockBalance;
        },
      );

      if (isPlayerA) {
        pot.fundedA = true;
      } else {
        pot.fundedB = true;
      }

      this.logger.debug(
        `Staked ${fromStroops(context.stake)} LYRIC for ${userId}; balance now ${fromStroops(newBalance)}`,
      );

      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: this.fakeTxHash(),
        newBalance,
        message: `Staked ${fromStroops(context.stake)} LYRIC`,
      };
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        return this.failure(error.message);
      }

      this.logger.error(
        `Error staking for user ${userId}`,
        (error as Error).stack,
      );
      return this.failure(`Failed to stake: ${(error as Error).message}`);
    }
  }

  /**
   * The mock backend has no wallets, so nothing ever needs a client signature
   * and this can only be reached by a caller that ignored `status`.
   */
  async confirmStake(): Promise<TokenTransactionResult> {
    return this.failure(
      'The mock settlement backend signs stakes itself; there is nothing to confirm',
    );
  }

  async releaseToWinner(
    winnerId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    const pot = this.pots.get(context.sessionId);

    if (!pot) {
      return this.failure(`No pot open for session ${context.sessionId}`);
    }

    if (pot.settled) {
      return this.failure('This pot has already been settled');
    }

    if (!pot.fundedA || !pot.fundedB) {
      return this.failure(
        'Both players must stake before the pot can be released',
      );
    }

    if (winnerId !== context.playerAId && winnerId !== context.playerBId) {
      return this.failure('The winner must be one of the wagering players');
    }

    const payout = multiplyStroops(context.stake, 2);

    try {
      const newBalance = await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          const winner = await this.lockUser(manager, winnerId);
          winner.mockBalance = addStroops(winner.mockBalance, payout);
          await manager.save(winner);
          return winner.mockBalance;
        },
      );

      pot.settled = true;

      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: this.fakeTxHash(),
        newBalance,
        message: `You won ${fromStroops(payout)} LYRIC!`,
      };
    } catch (error) {
      this.logger.error(
        `Error releasing pot to winner ${winnerId}`,
        (error as Error).stack,
      );
      return this.failure(
        `Failed to release the pot: ${(error as Error).message}`,
      );
    }
  }

  async refundEscrow(context: EscrowContext): Promise<TokenTransactionResult> {
    const pot = this.pots.get(context.sessionId);

    if (!pot) {
      return this.failure(`No pot open for session ${context.sessionId}`);
    }

    if (pot.settled) {
      return this.failure('This pot has already been settled');
    }

    const refunds: string[] = [];
    if (pot.fundedA) refunds.push(context.playerAId);
    if (pot.fundedB) refunds.push(context.playerBId);

    try {
      await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          for (const userId of refunds) {
            const user = await this.lockUser(manager, userId);
            user.mockBalance = addStroops(user.mockBalance, context.stake);
            await manager.save(user);
          }
        },
      );

      pot.fundedA = false;
      pot.fundedB = false;
      pot.settled = true;

      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: this.fakeTxHash(),
        message: `Refunded ${fromStroops(context.stake)} LYRIC to ${refunds.length} player(s)`,
      };
    } catch (error) {
      this.logger.error(
        `Error refunding pot for session ${context.sessionId}`,
        (error as Error).stack,
      );
      return this.failure(`Failed to refund: ${(error as Error).message}`);
    }
  }

  async getUserBalance(userId: string): Promise<Stroops> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.mockBalance;
  }

  async hasSufficientTokens(userId: string, amount: Stroops): Promise<boolean> {
    try {
      return isAtLeast(await this.getUserBalance(userId), amount);
    } catch (error) {
      this.logger.error(
        `Error checking balance for user ${userId}`,
        (error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Nothing to reconcile: this backend's writes are committed in the same
   * database transaction that records them, so they cannot be left in doubt.
   */
  async reconcile(txHash: string): Promise<TokenTransactionResult> {
    return {
      success: true,
      status: SettlementStatus.CONFIRMED,
      txHash,
      message: 'Mock settlements are always final',
    };
  }

  /**
   * Loads a user with a row lock so two concurrent wagers cannot each read the
   * same balance and both decide it is sufficient.
   */
  private async lockUser(
    manager: EntityManager,
    userId: string,
  ): Promise<User> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  private failure(message: string): TokenTransactionResult {
    return { success: false, status: SettlementStatus.FAILED, message };
  }

  /**
   * A stand-in for a Stellar transaction hash so that callers, the database
   * schema and the API response shape are identical in both modes.
   */
  private fakeTxHash(): string {
    return `mock:${randomBytes(32).toString('hex')}`;
  }
}

class InsufficientBalanceError extends Error {
  constructor(balance: Stroops, required: Stroops) {
    super(
      `Insufficient balance: have ${fromStroops(balance)} LYRIC, need ${fromStroops(required)} LYRIC`,
    );
    // Referenced so the numeric values are validated even when only the
    // formatted message is used.
    void toBigInt(balance);
  }
}
