import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { IKeyStore } from '../interfaces/key-store.interface';
import { STELLAR_CONFIG } from '../stellar.constants';
import type { StellarConfig } from '../stellar.config';

/**
 * Key store backed by environment variables.
 *
 * The resolver key is read from `STELLAR_RESOLVER_SECRET`. In custodial mode,
 * per-player keys are derived deterministically from
 * `STELLAR_CUSTODIAL_MASTER_SEED` and the user's ID, so the same user always
 * maps to the same Stellar account without storing one secret per player.
 *
 * This is appropriate for local development and testnet demos. For anything
 * holding real value, replace it with a KMS-backed implementation of
 * {@link IKeyStore}: a master seed sitting in an environment variable is one
 * leaked process dump away from draining every derived account.
 */
@Injectable()
export class EnvKeyStore implements IKeyStore {
  readonly name = 'env';

  private readonly logger = new Logger(EnvKeyStore.name);
  private readonly resolverKeypair: Keypair | null;
  private readonly custodialMasterSeed: string | null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(STELLAR_CONFIG) private readonly stellarConfig: StellarConfig,
  ) {
    const resolverSecret = this.configService.get<string>(
      'STELLAR_RESOLVER_SECRET',
    );
    this.resolverKeypair = resolverSecret
      ? Keypair.fromSecret(resolverSecret)
      : null;

    this.custodialMasterSeed =
      this.configService.get<string>('STELLAR_CUSTODIAL_MASTER_SEED') ?? null;

    if (this.custodial && !this.custodialMasterSeed) {
      throw new Error(
        'STELLAR_CUSTODIAL_MASTER_SEED is required when STELLAR_CUSTODY_MODE=custodial',
      );
    }

    if (this.custodial) {
      this.logger.warn(
        'Deriving player keys from an environment seed. Use a KMS-backed key ' +
          'store before handling funds of real value.',
      );
    }
  }

  get custodial(): boolean {
    return this.stellarConfig.custodyMode === 'custodial';
  }

  getResolverKeypair(): Keypair {
    if (!this.resolverKeypair) {
      throw new Error(
        'No resolver key configured. Set STELLAR_RESOLVER_SECRET to the secret ' +
          'seed of the account registered as the escrow contract resolver.',
      );
    }

    return this.resolverKeypair;
  }

  async getPlayerSigner(userId: string): Promise<Keypair | null> {
    if (!this.custodial) {
      return null;
    }

    return this.deriveKeypair(userId);
  }

  async getPlayerAddress(userId: string): Promise<string | null> {
    if (!this.custodial) {
      return null;
    }

    return this.deriveKeypair(userId).publicKey();
  }

  /**
   * Derives a stable ed25519 keypair for a user.
   *
   * HMAC-SHA256 over the user ID gives exactly the 32 raw bytes a Stellar seed
   * needs, and is domain-separated by the `lyricsflip:player:` prefix so the
   * same master seed can safely derive other key families later.
   */
  private deriveKeypair(userId: string): Keypair {
    if (!this.custodialMasterSeed) {
      throw new Error('Custodial master seed is not configured');
    }

    const raw = createHmac('sha256', this.custodialMasterSeed)
      .update(`lyricsflip:player:${userId}`)
      .digest();

    return Keypair.fromRawEd25519Seed(raw);
  }
}

/**
 * Key store for non-custodial deployments: it holds the resolver key and
 * nothing else. Player signatures come from the player's own wallet.
 */
@Injectable()
export class NonCustodialKeyStore implements IKeyStore {
  readonly name = 'non-custodial';
  readonly custodial = false;

  private readonly resolverKeypair: Keypair | null;

  constructor(private readonly configService: ConfigService) {
    const resolverSecret = this.configService.get<string>(
      'STELLAR_RESOLVER_SECRET',
    );

    if (resolverSecret && !StrKey.isValidEd25519SecretSeed(resolverSecret)) {
      throw new Error('STELLAR_RESOLVER_SECRET is not a valid secret seed');
    }

    this.resolverKeypair = resolverSecret
      ? Keypair.fromSecret(resolverSecret)
      : null;
  }

  getResolverKeypair(): Keypair {
    if (!this.resolverKeypair) {
      throw new Error('No resolver key configured (STELLAR_RESOLVER_SECRET)');
    }

    return this.resolverKeypair;
  }

  async getPlayerSigner(): Promise<Keypair | null> {
    return null;
  }

  async getPlayerAddress(): Promise<string | null> {
    return null;
  }
}
