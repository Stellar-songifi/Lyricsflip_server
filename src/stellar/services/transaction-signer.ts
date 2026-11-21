import { Keypair } from '@stellar/stellar-sdk';

/**
 * A signer that can produce Ed25519 signatures for Stellar transactions.
 *
 * `publicKey()` returns the Stellar-encoded public key (G... address) that
 * corresponds to the key used by `sign()`. `sign()` receives the 32-byte
 * transaction hash and returns the 64-byte Ed25519 signature.
 */
export interface TransactionSigner {
  publicKey(): string;
  sign(hash: Buffer): Promise<Buffer>;
}

/**
 * Signer backed by a raw Ed25519 secret key held in the environment.
 */
export class EnvKeySigner implements TransactionSigner {
  private readonly keypair: Keypair;

  constructor(secretKey: string) {
    this.keypair = Keypair.fromSecret(secretKey);
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const signature = this.keypair.sign(hash);
    return Buffer.from(signature);
  }
}

/**
 * Minimal shape of the AWS KMS client used by `AwsKmsSigner`.
 *
 * Declared structurally so this module does not depend on a specific
 * `@aws-sdk/client-kms` version at compile time.
 */
export interface KmsClientLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * Minimal shape of the AWS KMS `Sign` command constructor.
 */
export interface KmsSignCommandLike {
  new (input: {
    KeyId: string;
    Message: Uint8Array;
    MessageType: 'RAW' | 'DIGEST';
    SigningAlgorithm: string;
  }): unknown;
}

export interface AwsKmsSignerOptions {
  client: KmsClientLike;
  keyId: string;
  publicKey: string;
  /**
   * KMS signing algorithm name for Ed25519 keys.
   *
   * AWS KMS uses `ECC_SECG_P256K1` / `RSASSA_PKCS1_V1_5_SHA_256` etc. for
   * other key types; for Ed25519 keys the algorithm is `ED25519`. Support
   * for Ed25519 keys requires `@aws-sdk/client-kms` >= 3.600.0 (the
   * `SigningAlgorithm` union gained `ED25519` in that release). Older
   * versions reject the value at the type level.
   */
  signingAlgorithm?: string;
  SignCommand: KmsSignCommandLike;
}

/**
 * Signer backed by an AWS KMS asymmetric key (Ed25519).
 */
export class AwsKmsSigner implements TransactionSigner {
  private readonly client: KmsClientLike;
  private readonly keyId: string;
  private readonly stellarPublicKey: string;
  private readonly signingAlgorithm: string;
  private readonly SignCommand: KmsSignCommandLike;

  constructor(options: AwsKmsSignerOptions) {
    this.client = options.client;
    this.keyId = options.keyId;
    this.stellarPublicKey = options.publicKey;
    this.signingAlgorithm = options.signingAlgorithm ?? 'ED25519';
    this.SignCommand = options.SignCommand;
  }

  publicKey(): string {
    return this.stellarPublicKey;
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const command = new this.SignCommand({
      KeyId: this.keyId,
      Message: new Uint8Array(hash),
      MessageType: 'DIGEST',
      SigningAlgorithm: this.signingAlgorithm,
    });

    const response = (await this.client.send(command)) as {
      Signature?: Uint8Array;
    };

    if (!response.Signature) {
      throw new Error('AWS KMS did not return a signature');
    }

    return Buffer.from(response.Signature);
  }
}

/**
 * Minimal shape of a Vault Transit client used by `VaultTransitSigner`.
 */
export interface VaultTransitClientLike {
  sign(data: {
    name: string;
    input: string;
    hash_algorithm?: string;
    prehashed?: boolean;
  }): Promise<{ data?: { signature?: string } }>;
}

export interface VaultTransitSignerOptions {
  client: VaultTransitClientLike;
  keyName: string;
  publicKey: string;
}

/**
 * Signer backed by HashiCorp Vault Transit (Ed25519 key).
 */
export class VaultTransitSigner implements TransactionSigner {
  private readonly client: VaultTransitClientLike;
  private readonly keyName: string;
  private readonly stellarPublicKey: string;

  constructor(options: VaultTransitSignerOptions) {
    this.client = options.client;
    this.keyName = options.keyName;
    this.stellarPublicKey = options.publicKey;
  }

  publicKey(): string {
    return this.stellarPublicKey;
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const response = await this.client.sign({
      name: this.keyName,
      input: hash.toString('base64'),
      prehashed: true,
    });

    const signature = response.data?.signature;
    if (!signature) {
      throw new Error('Vault Transit did not return a signature');
    }

    // Vault returns "vault:v1:<base64 signature>".
    const parts = signature.split(':');
    const encoded = parts[parts.length - 1];
    if (!encoded) {
      throw new Error('Vault Transit returned a malformed signature');
    }

    return Buffer.from(encoded, 'base64');
  }
}