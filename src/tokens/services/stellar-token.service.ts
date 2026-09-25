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
    signedXdr: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult> {
    try {
      const result = await this.escrow.submitSignedStake(signedXdr);

      return this.toTransactionResult(
        result,
        `Stake of ${fromStroops(context.stake)} LYRIC confirmed`,
      );
    } catch (error) {
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
        submission.error ??
        'Transaction is still unconfirmed; the pot has not moved on-chain.',
    };
  }

  /**
   * Resolves a player to the address a payout must go to: the one recorded on
   * the on-chain pot, not whatever is currently linked to their account.
   *
   * A player can unlink or relink their wallet in the window between staking
   * and settlement being blocked elsewhere, but this is the line that actually
   * decides where the money goes, so it never trusts the live `stellarAddress`
   * for a payout. Falling back to `requireAddress` only covers a pot the
   * backend cannot read (or one from before this existed), and only for a
   * player who currently has an address linked.
   */
  private async addressForPlayer(
    userId: string,
    context: EscrowContext,
  ): Promise<string> {
    const pot = await this.escrow.getPot(context.sessionId);

    if (pot) {
      if (userId === context.playerAId) {
        return pot.playerA;
      }
      if (userId === context.playerBId) {
        return pot.playerB;
      }
    }

    return this.requireAddress(userId);
  }

  /**
   * Resolves a user to the Stellar address they proved ownership of.
   *
   * An unverified address is refused rather than used: paying a pot to an
   * address nobody has signed for is unrecoverable.
   */
  private async requireAddress(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!user.stellarAddress) {
      throw new BadRequestException(
        `${user.username} has not linked a Stellar wallet yet. ` +
          'Link one via POST /auth/stellar/challenge before joining a wagered match.',
      );
    }

    if (!user.stellarAddressVerifiedAt) {
      throw new BadRequestException(
        `${user.username}'s Stellar wallet is not verified. ` +
          'Complete the SEP-10 challenge to prove ownership.',
      );
    }

    return user.stellarAddress;
  }

  /**
   * Reads a balance without letting a failed read fail the whole settlement:
   * the balance is informational, the transaction result is not.
   */
  private async safeBalance(address: string): Promise<Stroops | undefined> {
    try {
      return await this.escrow.getTokenBalance(address);
    } catch (error) {
      this.logger.debug(
        `Balance read for ${address} failed: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private toTransactionResult(
    result: SubmitResult,
    successMessage: string,
    newBalance?: Stroops,
  ): TokenTransactionResult {
    if (result.confirmed) {
      return {
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: result.hash,
        ledger: result.ledger,
        newBalance,
        message: successMessage,
      };
    }

    // An unconfirmed submission is not a failure: the transaction may still be
    // included. Reporting it as SUBMITTED keeps the wager in a state the
    // reconciler will revisit, instead of one a retry could double-settle.
    return {
      success: false,
      status: SettlementStatus.SUBMITTED,
      txHash: result.hash,
      message: result.error ?? 'Awaiting network confirmation',
    };
  }

  private toFailure(error: unknown, action: string): TokenTransactionResult {
    const message = (error as Error).message;
    this.logger.error(
      `Failed to ${action}: ${message}`,
      (error as Error).stack,
    );

    return {
      success: false,
      status: SettlementStatus.FAILED,
      message: `Failed to ${action}: ${message}`,
    };
  }
}
