import type { Stroops } from '../../stellar/amount.util';
import type { SettlementMode } from '../../stellar/stellar.config';
import type { UnsignedTransaction } from '../../stellar/services/stellar-rpc.service';

/**
 * Where a token movement has got to.
 *
 * On-chain settlement is not instantaneous, so "the call returned" and "the
 * funds moved" are different events and the interface has to be able to say so.
 */
export enum SettlementStatus {
  /** The transaction is built but waiting on the player's wallet signature. */
  PENDING_SIGNATURE = 'pending_signature',
  /** Submitted to the network, outcome not yet known. */
  SUBMITTED = 'submitted',
  /** Included in a ledger and successful. */
  CONFIRMED = 'confirmed',
  /** Rejected by the network or reverted by the contract. */
  FAILED = 'failed',
}

/**
 * Everything a settlement backend needs to identify one wager.
 *
 * `sessionId` doubles as the escrow key on-chain and the idempotency key off
 * it: re-running a stake for the same session cannot create a second pot,
 * because the contract rejects a duplicate session.
 */
export interface EscrowContext {
  /** Game session UUID. Keys the pot in the escrow contract. */
  sessionId: string;
  /** Internal user ID of the first player. */
  playerAId: string;
  /** Internal user ID of the second player. */
  playerBId: string;
  /** Amount each player stakes, in token base units. */
  stake: Stroops;
}

export interface TokenTransactionResult {
  /** True only when the movement is known to have completed. */
  success: boolean;
  /** How far the movement got. */
  status: SettlementStatus;
  /** Stellar transaction hash, once one exists. */
  txHash?: string;
  /** Ledger the transaction landed in. */
  ledger?: number;
  /** The account's balance afterwards, when the backend can read it cheaply. */
  newBalance?: Stroops;
  /**
   * Set when `status` is `PENDING_SIGNATURE`: the transaction for the player's
   * wallet to sign and hand back.
   */
  unsignedTransaction?: UnsignedTransaction;
  /** Human-readable detail, safe to surface to players. */
  message?: string;
}

/**
 * The settlement backend for wagered matches.
 *
 * The interface is escrow-shaped rather than balance-shaped: a stake goes into
 * a pot identified by the session, and the pot is later released or refunded as
 * a whole. That mirrors what the Soroban contract actually does, and it keeps
 * the mock implementation honest about the same ordering constraints.
 */
export interface ITokenService {
  /** Which backend this is, for logs, health checks and API responses. */
  readonly settlementMode: SettlementMode;

  /**
   * Creates the escrow pot for a session. Must be called before either player
   * stakes.
   */
  openEscrow(context: EscrowContext): Promise<TokenTransactionResult>;

  /**
   * Moves one player's stake into escrow.
   *
   * In custodial mode this completes on its own. In non-custodial mode it
   * returns `PENDING_SIGNATURE` together with an unsigned transaction for the
   * player's wallet; the signed result comes back through {@link confirmStake}.
   */
  stakeTokens(
    userId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult>;

  /**
   * Submits a stake transaction that a player's wallet signed.
   * @param signedXdr Base64 transaction envelope returned by the wallet.
   */
  confirmStake(
    signedXdr: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult>;

  /** Releases the whole pot to the winner. */
  releaseToWinner(
    winnerId: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult>;

  /**
   * Returns each staked amount to the player who staked it — used for draws and
   * abandoned matches. Refunds the pot as a unit, not per player.
   */
  refundEscrow(context: EscrowContext): Promise<TokenTransactionResult>;

  /** The user's spendable balance of the staking token, in base units. */
  getUserBalance(userId: string): Promise<Stroops>;

  /** Whether the user can cover a stake of `amount` base units. */
  hasSufficientTokens(userId: string, amount: Stroops): Promise<boolean>;

  /**
   * Re-reads a previously submitted transaction and reports its current state.
   * Used by reconciliation when a submission's outcome was left ambiguous.
   */
  reconcile(
    txHash: string,
    context: EscrowContext,
  ): Promise<TokenTransactionResult>;
}

export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
