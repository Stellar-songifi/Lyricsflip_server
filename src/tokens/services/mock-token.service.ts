import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { randomBytes } from 'crypto';
import { User } from '../../users/entities/user.entity';
import { Wager } from '../entities/wager.entity';
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
 *
 * Pot state is derived from the persisted `wagers` row (stake hashes and
 * status) rather than an in-process map, so a pot survives restarts and is
 * shared across instances. Pot mutations happen inside the same transaction as
 * the balance changes, using the existing row lock pattern.
 */
@Injectable()
export class MockTokenService implements ITokenService {
  readonly settlementMode: SettlementMode = 'mock';

  private readonly logger = new Logger(MockTokenService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
  ) {}

  async openEscrow(context: EscrowContext): Promise<TokenTransactionResult> {
    const existing = await this.wagerRepository.findOne({
      where: { sessionId: context.sessionId },
    });

    if (existing) {
      return this.failure(
        `A pot already exists for session ${context.sessionId}`,
      );
    }

    const wager = this.wagerRepository.create({
      sessionId: context.sessionId,
      playerAId: context.playerAId,
      playerBId: context.playerBId,
      stake: context.stake,
      status: 'OPEN',
      stakeHashA: null,
      stakeHashB: null,
    });

    await this.wagerRepository.save(wager);

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
    const isPlayerA = userId === context.playerAId;
    const isPlayerB = userId === context.playerBId;

    if (!isPlayerA && !isPlayerB) {
      return this.failure('User is not a player in this wager');
    }

    try {
      const newBalance = await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          const wager = await this.lockWager(manager, context.sessionId);

          if (!wager) {
            throw new NoPotError(context.sessionId);
          }

          if (wager.status === 'SETTLED') {
            throw new PotSettledError();
          }

          if (
            (isPlayerA && wager.stakeHashA) ||
            (isPlayerB && wager.stakeHashB)
          ) {
            throw new AlreadyStakedError();
          }

          const user = await this.lockUser(manager, userId);

          if (!isAtLeast(user.mockBalance, context.stake)) {
            throw new InsufficientBalanceError(user.mockBalance, context.stake);
          }

          user.mockBalance = subtractStroops(user.mockBalance, context.stake);
          await manager.save(user);

          const stakeHash = this.fakeTxHash();
          if (isPlayerA) {
            wager.stakeHashA = stakeHash;
          } else {
            wager.stakeHashB = stakeHash;
          }
          await manager.save(wager);

          return user.mockBalance;
        },
      );

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
      if (
        error instanceof InsufficientBalanceError ||
        error instanceof NoPotError ||
        error instanceof PotSettledError ||
        error instanceof AlreadyStakedError
      ) {
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
    if (winnerId !== context.playerAId && winnerId !== context.playerBId) {
      return this.failure('The winner must be one of the wagering players');
    }

    const payout = multiplyStroops(context.stake, 2);

    try {
      const newBalance = await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          const wager = await this.lockWager(manager, context.sessionId);

          if (!wager) {
            throw new NoPotError(context.sessionId);
          }

          if (wager.status === 'SETTLED') {
            throw new PotSettledError();
          }

          if (!wager.stakeHashA || !wager.stakeHashB) {
            throw new BothMustStakeError();
          }

          const winner = await this.lockUser(manager, winnerId);
          winner.mockBalance = addStroops(winner.mockBalance, payout);
          await manager.save(winner);

          wager.status = 'SETTLED';
          await manager.save(wager);

          return winner.mockBalance;
        },
      );

      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: this.fakeTxHash(),
        newBalance,
        message: `You won ${fromStroops(payout)} LYRIC!`,
      };
    } catch (error) {
      if (
        error instanceof NoPotError ||
        error instanceof PotSettledError ||
        error instanceof BothMustStakeError
      ) {
        return this.failure(error.message);
      }

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
    try {
      const refunded = await this.userRepository.manager.transaction(
        async (manager: EntityManager) => {
          const wager = await this.lockWager(manager, context.sessionId);

          if (!wager) {
            throw new NoPotError(context.sessionId);
          }

          if (wager.status === 'SETTLED') {
            throw new PotSettledError();
          }

          const refunds: string[] = [];
          if (wager.stakeHashA) refunds.push(context.playerAId);
          if (wager.stakeHashB) refunds.push(context.playerBId);

          for (const userId of refunds) {
            const user = await this.lockUser(manager, userId);
            user.mockBalance = addStroops(user.mockBalance, context.stake);
            await manager.save(user);
          }

          wager.stakeHashA = null;
          wager.stakeHashB = null;
          wager.status = 'SETTLED';
          await manager.save(wager);

          return refunds.length;
        },
      );

      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: this.fakeTxHash(),
        message: `Refunded ${fromStroops(context.stake)} LYRIC to ${refunded} player(s)`,
      };
    } catch (error) {
      if (error instanceof NoPotError || error instanceof PotSettledError) {
        return this.failure(error.message);
      }

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
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      return false;
    }

    return isAtLeast(user.mockBalance, amount);
  }

  private async lockUser(
    manager: EntityManager,
    userId: string,
  ): Promise<User> {
    const user = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  private async lockWager(
    manager: EntityManager,
    sessionId: string,
  ): Promise<Wager | null> {
    return manager
      .createQueryBuilder(Wager, 'wager')
      .setLock('pessimistic_write')
      .where('wager.sessionId = :sessionId', { sessionId })
      .getOne();
  }

  private failure(message: string): TokenTransactionResult {
    return {
      success: false,
      status: SettlementStatus.FAILED,
      message,
    };
  }

  private fakeTxHash(): string {
    return `mock_${randomBytes(16).toString('hex')}`;
  }
}

class InsufficientBalanceError extends Error {
  constructor(balance: Stroops, required: Stroops) {
    super(
      `Insufficient balance: have ${fromStroops(balance)}, need ${fromStroops(required)}`,
    );
  }
}

class NoPotError extends Error {
  constructor(sessionId: string) {
    super(`No pot open for session ${sessionId}`);
  }
}

class PotSettledError extends Error {
  constructor() {
    super('This pot has already been settled');
  }
}

class AlreadyStakedError extends Error {
  constructor() {
    super('This player has already staked');
  }
}

class BothMustStakeError extends Error {
  constructor() {
    super('Both players must stake before the pot can be released');
  }
}
