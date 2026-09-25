import { Logger } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import type { RemoteSigner } from './kms-key-store.service';

/**
 * {@link RemoteSigner} backed by an AWS KMS asymmetric signing key
 * (`KeySpec: ECC_SECG_P256K1` is NOT usable here - Stellar needs raw ed25519
 * signatures, so the KMS key must be created with an ed25519 key spec that
 * supports raw message signing).
 *
 * Talks to KMS through the `@aws-sdk/client-kms` v3 client, imported
 * dynamically so environments that never select `STELLAR_KEY_STORE=kms`
 * don't need the package installed.
 */
export class AwsKmsSigner implements RemoteSigner {
  readonly id: string;

  private readonly logger = new Logger(AwsKmsSigner.name);

  constructor(
    private readonly keyId: string,
    private readonly region: string,
  ) {
    this.id = `kms:${keyId}`;
  }

  async getPublicKey(): Promise<string> {
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
        Message: hash,
        MessageType: 'RAW',
        SigningAlgorithm: 'EDDSA',
      }),
    );

    if (!result.Signature) {
      throw new Error(`KMS returned no signature for ${this.keyId}`);
    }

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
 * {@link RemoteSigner} backed by a HashiCorp Vault Transit ed25519 key.
 * Uses the Transit HTTP API directly (`fetch`) rather than a client library,
 * since Vault has no first-party Node SDK.
 */
export class VaultTransitSigner implements RemoteSigner {
  readonly id: string;

  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly keyName: string,
  ) {
    this.id = `vault:${keyName}`;
  }

  async getPublicKey(): Promise<string> {
    const res = await this.request(`/v1/transit/keys/${this.keyName}`, 'GET');
    const body = await res.json();
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
    const body = await res.json();
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
