import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  EscrowContext,
  ITokenService,
  SettlementStatus,
  TokenTransactionResult,
} from '../interfaces/token.interface';
import {
  EscrowContractService,
  PotStatus,
} from '../../stellar/services/escrow-contract.service';
import {
  StellarRpcService,
  SubmitResult,
} from '../../stellar/services/stellar-rpc.service';
import { IKeyStore } from '../../stellar/interfaces/key-store.interface';
import { KEY_STORE, STELLAR_CONFIG } from '../../stellar/stellar.constants';
import type {
  StellarConfig,
  SettlementMode,
} from '../../stellar/stellar.config';
import { Stroops, fromStroops, isAtLeast } from '../../stellar/amount.util';
import { checkTrustline } from '../../stellar/trustline.util';

/**
 * Settlement backed by the LyricsFlip escrow contract on Stellar.
 *
 * Stakes move real tokens into a Soroban contract; payouts come back out of it.
 * Two properties drive the shape of this class:
 *
 * 1. **A player's stake needs the player's signature.** In non-custodial mode
 *    the backend cannot produce it, so `stakeTokens` returns an unsigned
 *    transaction and the flow continues in `confirmStake`.
 * 2. **Submission is not settlement.** Every method reports the status it
 *    actually observed, and an ambiguous submission is reported as such rather
 *    than optimistically as success.
 */
@Injectable()
export class StellarTokenService implements ITokenService {
  readonly settlementMode: SettlementMode = 'stellar';

  private readonly logger = new Logger(StellarTokenService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(STELLAR_CONFIG) private readonly config: StellarConfig,
    @Inject(KEY_STORE) private readonly keyStore: IKeyStore,
    private readonly escrow: EscrowContractService,
    private readonly rpc: StellarRpcService,
  ) {}

  async openEscrow(context: EscrowContext): Promise<TokenTransactionResult> {
    try {
      const [playerAAddress, playerBAddress] = await Promise.all([
        this.requireAddress(context.playerAId),
        this.requireAddress(context.playerBId),
      ]);

      await this.assertCanReceiveToken(playerAAddress, context.playerAId);
      await this.assertCanReceiveToken(playerBAddress, context.playerBId);

      const result = await this.escrow.openPot(
        this.keyStore.getResolverKeypair(),
        context.sessionId,
        playerAAddress,
        playerBAddress,
        context.stake,
      );

      return this.toTransactionResult(
        result,
        `Escrow opened for ${fromStroops(context.stake)} LYRIC per player`,
      );
    } catch (error) {
      return this.toFailure(error, 'open the escrow pot');
    }
  }

  async stakeTokens(
    userId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    try {
      const address = await this.requireAddress(userId);
      const signer = await this.keyStore.getPlayerSigner(userId);

      if (!signer) {
        // Non-custodial: the player's wallet has to authorise this.
        const unsigned = await this.escrow.buildUnsignedStake(
          context.sessionId,
          address,
        );

        return {
          success: false,
          status: SettlementStatus.PENDING_SIGNATURE,
          txHash: unsigned.hash,
          unsignedTransaction: unsigned,
          message:
            `Sign this transaction in your wallet to stake ` +
            `${fromStroops(context.stake)} LYRIC, then submit it back to confirm the wager.`,
        };
      }

      const transaction = await this.escrow.buildStake(
        signer.publicKey(),
        context.sessionId,
        address,
      );

      const result = await this.rpc.signAndSubmit(transaction, [signer]);

      return this.toTransactionResult(
        result,
        `Staked ${fromStroops(context.stake)} LYRIC`,
        await this.safeBalance(address),
      );
    } catch (error) {
      return this.toFailure(error, 'stake tokens');
    }
  }

  async confirmStake(
    userId: string,
    signedXdr: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    try {
      const address = await this.requireAddress(userId);
      const result = await this.escrow.submitSignedStake(
        signedXdr,
        context.sessionId,
        address,
      );

      return this.toTransactionResult(
        result,
        `Stake of ${fromStroops(context.stake)} LYRIC confirmed`,
      );
    } catch (error) {
      // A rejected envelope is the client's mistake, not a settlement failure.
      if (error instanceof BadRequestException) {
        throw error;
      }

      return this.toFailure(error, 'confirm the stake');
    }
  }

  async releaseToWinner(
    winnerId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    try {
      const winnerAddress = await this.addressForPlayer(winnerId, context);

      const result = await this.escrow.resolve(
        this.keyStore.getResolverKeypair(),
        context.sessionId,
        winnerAddress,
      );

      return this.toTransactionResult(
        result,
        `You won ${fromStroops(context.stake)} LYRIC ×2!`,
        await this.safeBalance(winnerAddress),
      );
    } catch (error) {
      return this.toFailure(error, 'release the pot to the winner');
    }
  }

  async refundEscrow(context: EscrowContext): Promise<TokenTransactionResult> {
    try {
      const result = await this.escrow.refund(
        this.keyStore.getResolverKeypair(),
        context.sessionId,
      );

      return this.toTransactionResult(
        result,
        `Refunded ${fromStroops(context.stake)} LYRIC to each player who staked`,
      );
    } catch (error) {
      return this.toFailure(error, 'refund the pot');
    }
  }

  async getUserBalance(userId: string): Promise<Stroops> {
    const address = await this.requireAddress(userId);
    return this.escrow.getTokenBalance(address);
  }

  async hasSufficientTokens(userId: string, amount: Stroops): Promise<boolean> {
    try {
      return isAtLeast(await this.getUserBalance(userId), amount);
    } catch (error) {
      // "You have not linked a wallet" is a different problem from "you cannot
      // afford this", and reporting the first as the second sends the player
      // off to buy tokens they may already hold. Only an unreadable balance —
      // an RPC failure, say — is answered with a plain false.
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      this.logger.warn(
        `Could not read balance for user ${userId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Establishes what really happened to a transaction whose outcome was left
   * unknown.
   *
   * The transaction lookup answers "did this submission land"; the pot read
   * answers "did the funds move", which is the question that actually decides
   * whether the wager can be retried. A pot that is already `Resolved` means a
   * previous attempt succeeded even if this backend never saw the receipt.
   */
  async reconcile(
    txHash: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    const [submission, pot] = await Promise.all([
      this.rpc.lookupTransaction(txHash),
      this.escrow.getPot(context.sessionId),
    ]);

    if (submission.confirmed) {
      return this.toTransactionResult(
        submission,
        'Transaction confirmed on-chain',
      );
    }

    if (
      pot?.status === PotStatus.RESOLVED ||
      pot?.status === PotStatus.REFUNDED
    ) {
      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash,
        message:
          `The escrow pot is already ${pot.status.toLowerCase()} on-chain; ` +
          'treating this wager as settled.',
      };
    }

    return {
      success: false,
      status: SettlementStatus.SUBMITTED,
      txHash,
      message:
        'The transaction has not been confirmed yet; it may still be in ' +
        'flight. Reconcile again before retrying.',
    };
  }

  /**
   * Rejects a wager before anything is written on-chain when a player's
   * account cannot receive the token.
   *
   * A SAC-wrapped classic asset only reaches an account that holds a
   * trustline for the underlying asset; a native Soroban token needs none.
   * The check is skipped for native tokens so we do not pay for a Horizon
   * round-trip that can never fail.
   */
  private async assertCanReceiveToken(
    address: string,
    userId: string,
  ): Promise<void> {
    if (!this.config.tokenIsSacWrapped) {
      return;
    }

    const result = await checkTrustline(
      address,
      this.config.tokenContractId,
      this.config.horizonUrl,
    );

    if (!result.hasTrustline) {
      throw new BadRequestException(
        `Player ${userId} cannot receive LYRIC: account ${address} has no ` +
          'trustline for the token. Add the trustline in your wallet before ' +
          'opening a wager.',
      );
    }
  }

  /**
   * Resolves a user's Stellar address, rejecting users who have not linked a
   * wallet.
   */
  private async requireAddress(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (!user.stellarPublicKey) {
      throw new BadRequestException(
        `User ${userId} has not linked a Stellar wallet`,
      );
    }

    return user.stellarPublicKey;
  }

  /**
   * Resolves the address a payout should be sent to, preferring the address
   * recorded on the escrow context when it belongs to the winner.
   */
  private async addressForPlayer(
    userId: string,
    context: EscrowContext,
  ): Promise<string> {
    if (context.playerAId === userId && context.playerAAddress) {
      return context.playerAAddress;
    }

    if (context.playerBId === userId && context.playerBAddress) {
      return context.playerBAddress;
    }

    return this.requireAddress(userId);
  }

  /**
   * Reads a balance without letting an RPC hiccup turn a successful
   * settlement into a reported failure.
   */
  private async safeBalance(address: string): Promise<Stroops | undefined> {
    try {
      return await this.escrow.getTokenBalance(address);
    } catch (error) {
      this.logger.warn(
        `Could not read balance for ${address}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * Maps a submission result onto the service's result contract, keeping the
   * distinction between "confirmed" and "submitted but unconfirmed".
   */
  private toTransactionResult(
    result: SubmitResult,
    message: string,
    balance?: Stroops,
  ): TokenTransactionResult {
    if (result.confirmed) {
      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: result.hash,
        balance,
        message,
      };
    }

    return {
      success: false,
      status: SettlementStatus.SUBMITTED,
      txHash: result.hash,
      balance,
      message: `${message} — submitted but not yet confirmed on-chain.`,
    };
  }

  /**
   * Turns an unexpected error into a reported settlement failure rather than
   * letting it escape as an unhandled exception.
   */
  private toFailure(
    error: unknown,
    action: string,
  ): TokenTransactionResult {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed to ${action}: ${message}`);

    return {
      success: false,
      status: SettlementStatus.FAILED,
      message: `Could not ${action}: ${message}`,
    };
  }
}
