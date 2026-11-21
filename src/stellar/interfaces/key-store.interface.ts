import { Keypair } from '@stellar/stellar-sdk';
import { TransactionSigner } from '../services/transaction-signer';

/**
 * Supplies the signing keys the backend needs.
 *
 * Two keys matter:
 *
 * - the **resolver**, which the escrow contract authorises to release or refund
 *   a pot. The backend always holds this one; it can move escrowed funds only
 *   along paths the contract allows.
 * - a **player** key, which authorises that player's stake. The backend holds
 *   this only in custodial mode. In non-custodial mode `getPlayerSigner`
 *   returns `null` and the caller hands unsigned XDR to the player's wallet.
 *
 * Implementations are deliberately behind an interface so that a production
 * deployment can swap the environment-backed store for AWS KMS, GCP KMS,
 * HashiCorp Vault or a hardware signer without touching call sites.
 */
export interface IKeyStore {
  /** Human-readable name of the backing store, for logs and health checks. */
  readonly name: string;

  /** Whether this store can sign on behalf of players. */
  readonly custodial: boolean;

  /**
   * The key the escrow contract accepts for `resolve` and `refund`.
   * Throws when the store has not been configured with one.
   *
   * Kept for call sites that need the raw `Keypair` (e.g. to derive the
   * address synchronously). Remote stores such as KMS or Vault cannot expose
   * the secret, so they throw here; use {@link getResolverSigner} instead.
   */
  getResolverKeypair(): Keypair;

  /**
   * The signer the escrow contract accepts for `resolve` and `refund`.
   * Works for every backing store, including remote ones that never expose
   * the secret key. Throws when the store has not been configured with one.
   */
  getResolverSigner(): TransactionSigner;

  /**
   * The signing key for a player's stake, or `null` when the player must sign
   * the transaction themselves.
   *
   * Kept for call sites that need the raw `Keypair`. Remote stores throw here;
   * use {@link getPlayerTransactionSigner} instead.
   */
  getPlayerSigner(userId: string): Promise<Keypair | null>;

  /**
   * The signer for a player's stake, or `null` when the player must sign the
   * transaction themselves. Works for every backing store.
   */
  getPlayerTransactionSigner(userId: string): Promise<TransactionSigner | null>;

  /**
   * The Stellar address a player's funds move from. In custodial mode this is
   * derived from the store; in non-custodial mode it is the address the player
   * linked to their account, which the caller supplies.
   */
  getPlayerAddress(userId: string): Promise<string | null>;
}
