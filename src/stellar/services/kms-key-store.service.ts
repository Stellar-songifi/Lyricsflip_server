import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { IKeyStore } from '../interfaces/key-store.interface';

/**
 * Key store that signs remotely instead of holding a Stellar secret seed in
 * the process.
 *
 * The resolver secret and the custodial master seed are the two most
 * sensitive values in this backend: the resolver can settle every open pot,
 * and the master seed can derive every custodial player key. `EnvKeyStore`
 * keeps both in the process environment, which is fine for local development
 * and testnet demos but not for anything holding real value - an environment
 * dump, a misconfigured log line or a compromised dependency is then enough
 * to drain every account the backend controls.
 *
 * `KmsKeyStore` never materialises that secret in this process. It resolves
 * the resolver's *public* key once at startup (from `STELLAR_RESOLVER_PUBLIC_KEY`,
 * or by asking the remote signer for it) and delegates every signature to a
 * pluggable {@link RemoteSigner}, which is expected to call out to a
 * provider such as AWS KMS (an asymmetric ED25519 signing key) or HashiCorp
 * Vault Transit (an ed25519 key). No default `RemoteSigner` implementation is
 * wired in here - production deployments provide one via
 * `KMS_SIGNER`/`VAULT_SIGNER` injection (see the `StellarModule` factory),
 * so this file has no hard dependency on an AWS or Vault SDK.
 *
 * ### Setup (AWS KMS)
 * 1. Create an asymmetric KMS key with `KeySpec=ECC_NIST_P256` is not
 *    supported by Stellar; use a KMS key that supports raw ed25519 signing
 *    (KMS's `SIGN_VERIFY` ED25519 key type), or front a HSM-backed ed25519
 *    key with a small signing service and speak to it as a `RemoteSigner`.
 * 2. Set `STELLAR_KEY_STORE=kms`, `STELLAR_KMS_KEY_ID` and
 *    `STELLAR_KMS_REGION`.
 * 3. Grant the deployment's IAM role `kms:Sign` and `kms:GetPublicKey` on
 *    that key ID, and nothing else - the private material never leaves KMS.
 *
 * ### Setup (HashiCorp Vault Transit)
 * 1. `vault secrets enable transit` and
 *    `vault write -f transit/keys/<name> type=ed25519`.
 * 2. Set `STELLAR_KEY_STORE=vault`, `STELLAR_VAULT_ADDR`,
 *    `STELLAR_VAULT_TOKEN` (short-lived, ideally from a Vault Agent sidecar)
 *    and `STELLAR_VAULT_TRANSIT_KEY`.
 *
 * ### Key rotation
 * Rotating the resolver key is a two-step, coordinated change: create the
 * new key in KMS/Vault (KMS: a new key version is a *new* key ID for signing
 * purposes; Vault: `vault write -f transit/keys/<name>/rotate` adds a new
 * version while old versions stay valid for verification), call the escrow
 * contract's `set_resolver` with the new public key, and only then point
 * `STELLAR_KMS_KEY_ID`/`STELLAR_VAULT_TRANSIT_KEY` at the new key and
 * restart. Never rotate the environment variable before `set_resolver`
 * lands, or the backend will sign with a key the contract no longer accepts.
 */
export interface RemoteSigner {
  /** Human-readable identifier for logs, e.g. `kms:<key-id>` or `vault:<key-name>`. */
  readonly id: string;

  /** The signer's Stellar (ed25519) public key, base32 `G...` address. */
  getPublicKey(): Promise<string>;

  /** Signs a 32-byte transaction hash, returning the raw 64-byte signature. */
  sign(hash: Buffer): Promise<Buffer>;
}

@Injectable()
export class KmsKeyStore implements IKeyStore {
  readonly name: string;
  readonly custodial = false;

  private readonly logger = new Logger(KmsKeyStore.name);
  private publicKey: string | null = null;

  constructor(
    private readonly signer: RemoteSigner,
    private readonly configService: ConfigService,
  ) {
    this.name = `remote:${signer.id}`;
  }

  /**
   * Resolves and caches the resolver's public key. Call this once during
   * application bootstrap (or lazily on first use) so `getResolverKeypair`
   * can stay synchronous, matching the `IKeyStore` contract used by existing
   * call sites.
   */
  async init(): Promise<void> {
    const configured = this.configService.get<string>(
      'STELLAR_RESOLVER_PUBLIC_KEY',
    );

    this.publicKey = configured ?? (await this.signer.getPublicKey());
    this.logger.log(
      `Resolver key resolved from ${this.signer.id}: ${this.publicKey}`,
    );
  }

  /**
   * `IKeyStore` was written around raw `Keypair`s, so existing call sites
   * expect one back. `KmsKeyStore` cannot hand out a `Keypair` with a private
   * key it does not have; call sites that need to actually sign with a
   * remote key must be migrated to `sign(hash)` (see `signHash`) instead of
   * pulling the secret out of a `Keypair`. Until that migration lands, this
   * throws rather than silently returning an unusable, keyless `Keypair`.
   */
  getResolverKeypair(): Keypair {
    throw new Error(
      `${this.name} does not expose a signing Keypair. Use signHash(hash) via ` +
        'the KEY_STORE provider instead of getResolverKeypair() when ' +
        'STELLAR_KEY_STORE=kms|vault.',
    );
  }

  /** The resolver's public key, once {@link init} has resolved it. */
  getResolverPublicKey(): string {
    if (!this.publicKey) {
      throw new Error(
        `${this.name} has not been initialised - call init() during bootstrap`,
      );
    }

    return this.publicKey;
  }

  /**
   * Signs a transaction hash with the remote key. This is the abstraction
   * `signAndSubmit` call sites should move to instead of pulling a
   * `Keypair` out of the key store and calling `keypair.sign(hash)` directly,
   * so the same call site works unchanged with any `IKeyStore` backend.
   */
  async signHash(hash: Buffer): Promise<Buffer> {
    return this.signer.sign(hash);
  }

  async getPlayerSigner(): Promise<Keypair | null> {
    // KMS/Vault-backed deployments are non-custodial by construction: the
    // remote key only ever signs resolver transactions. Custodial per-player
    // signing would need one remote key per player, which is out of scope
    // here - see issue #131's acceptance criteria (resolver secret only).
    return null;
  }

  async getPlayerAddress(): Promise<string | null> {
    return null;
  }
}
