import { Logger } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import type { TransactionSigner } from './transaction-signer';

/**
 * {@link TransactionSigner} backed by an AWS KMS asymmetric signing key.
 *
 * Stellar needs raw ed25519 signatures, so the KMS key must be created with
 * `KeySpec: ECC_NIST_EDWARDS25519` (or `ECC_SECG_EDWARDS25519` on older
 * regions) and `KeyUsage: SIGN_VERIFY`.
 *
 * Talks to KMS through the `@aws-sdk/client-kms` v3 client, imported
 * dynamically so environments that never select `STELLAR_KEY_STORE=kms`
 * don't need the package installed.
 *
 * Minimum SDK version: `@aws-sdk/client-kms` >= 3.450.0, the first release
 * whose `SigningAlgorithmSpec` union includes `'ED25519_SHA_512'` (the
 * algorithm name KMS uses for Ed25519 keys). Older versions reject the value
 * at the type level and at runtime.
 */
export class AwsKmsSigner implements TransactionSigner {
  readonly id: string;

  private readonly logger = new Logger(AwsKmsSigner.name);

  constructor(
    private readonly keyId: string,
    private readonly region: string,
  ) {
    this.id = `kms:${keyId}`;
  }

  async publicKey(): Promise<string> {
    const { KMSClient, GetPublicKeyCommand } = await this.loadSdk();
    const client = new KMSClient({ region: this.region });

    const result = await client.send(
      new GetPublicKeyCommand({ KeyId: this.keyId }),
    );

    if (!result.PublicKey) {
      throw new Error(`KMS returned no public key material for ${this.keyId}`);
    }

    // KMS returns a DER-encoded SubjectPublicKeyInfo; the raw 32-byte ed25519
    // public key is the last 32 bytes of that structure.
    const der = Buffer.from(result.PublicKey);
    const raw = der.subarray(der.length - 32);

    return StrKey.encodeEd25519PublicKey(raw);
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const { KMSClient, SignCommand } = await this.loadSdk();
    const client = new KMSClient({ region: this.region });

    const result = await client.send(
      new SignCommand({
        KeyId: this.keyId,
        // KMS expects a Uint8Array/Buffer for RAW messages; `hash` is already
        // a Buffer, which satisfies the SDK's `Uint8Array` type.
        Message: hash,
        MessageType: 'RAW',
        // KMS names the Ed25519 signing algorithm 'ED25519_SHA_512'. It is
        // present in `SigningAlgorithmSpec` from @aws-sdk/client-kms 3.450.0.
        SigningAlgorithm: 'ED25519_SHA_512',
      }),
    );

    if (!result.Signature) {
      throw new Error(`KMS returned no signature for ${this.keyId}`);
    }

    // The SDK types `Signature` as `Uint8Array`; wrap it in a Buffer so the
    // TransactionSigner contract (Promise<Buffer>) is honoured.
    return Buffer.from(result.Signature);
  }

  /**
   * Dynamic `import()` keeps `@aws-sdk/client-kms` an optional dependency:
   * only deployments that set `STELLAR_KEY_STORE=kms` need it installed.
   */
  private async loadSdk(): Promise<typeof import('@aws-sdk/client-kms')> {
    try {
      return await import('@aws-sdk/client-kms');
    } catch (error) {
      this.logger.error(
        '@aws-sdk/client-kms is not installed. Install it to use STELLAR_KEY_STORE=kms.',
      );
      throw error;
    }
  }
}

/**
 * {@link TransactionSigner} backed by a HashiCorp Vault Transit ed25519 key.
 * Uses the Transit HTTP API directly (`fetch`) rather than a client library,
 * since Vault has no first-party Node SDK.
 */
export class VaultTransitSigner implements TransactionSigner {
  readonly id: string;

  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly keyName: string,
  ) {
    this.id = `vault:${keyName}`;
  }

  async publicKey(): Promise<string> {
    const res = await this.request(`/v1/transit/keys/${this.keyName}`, 'GET');
    const body = (await res.json()) as {
      data?: {
        latest_version?: number;
        keys?: Record<string, { public_key?: string }>;
      };
    };
    const versions = body?.data?.keys ?? {};
    const latestVersion = body?.data?.latest_version;
    const publicKeyB64 = versions?.[latestVersion]?.public_key;

    if (!publicKeyB64) {
      throw new Error(`Vault returned no public key for ${this.keyName}`);
    }

    const raw = Buffer.from(publicKeyB64, 'base64');
    return StrKey.encodeEd25519PublicKey(raw);
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const res = await this.request(
      `/v1/transit/sign/${this.keyName}`,
      'POST',
      {
        input: hash.toString('base64'),
        prehashed: false,
      },
    );
    const body = (await res.json()) as { data?: { signature?: string } };
    const signature: string | undefined = body?.data?.signature;

    if (!signature) {
      throw new Error(`Vault returned no signature for ${this.keyName}`);
    }

    // Vault signatures look like "vault:v1:<base64>".
    const b64 = signature.split(':').pop() ?? '';
    return Buffer.from(b64, 'base64');
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<Response> {
    const res = await fetch(`${this.addr}${path}`, {
      method,
      headers: {
        'X-Vault-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(
        `Vault request to ${path} failed: ${res.status} ${res.statusText}`,
      );
    }

    return res;
  }
}
