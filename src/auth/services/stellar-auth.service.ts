import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Keypair, StrKey, WebAuth } from '@stellar/stellar-sdk';
import { User } from '../../users/entities/user.entity';
import { Wager, WagerStatus } from '../../tokens/entities/wager.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { Role } from '../roles/role.enum';
import { AuthResult, AuthTokenService } from './auth-token.service';
import {
  STELLAR_CONFIG,
  CHALLENGE_TIMEOUT_SECONDS,
} from '../../stellar/stellar.constants';
import type { StellarConfig } from '../../stellar/stellar.config';

export interface StellarChallenge {
  /** Base64 challenge transaction envelope for the wallet to sign. */
  transaction: string;
  /** The network the wallet must sign against. */
  network_passphrase: string;
}

/**
 * Wallet authentication over SEP-10 (Stellar Web Authentication).
 *
 * The backend issues a specially-formed transaction that can never be
 * submitted to the network — its sequence number is 0 — and asks the wallet to
 * sign it. A valid signature proves the holder controls the account's key
 * without any secret ever leaving the wallet.
 *
 * Password login is untouched: a player can hold an email/password account and
 * link a wallet to it, or authenticate with the wallet alone.
 */
@Injectable()
export class StellarAuthService {
  private readonly logger = new Logger(StellarAuthService.name);
  private readonly serverKeypair: Keypair;
  /** Fallback used only when no shared cache is injected. */
  private readonly usedNonces = new Map<string, number>();

  /** Wager statuses in which the pot is open and a payout address matters. */
  private static readonly ACTIVE_WAGER_STATUSES = [
    WagerStatus.PENDING,
    WagerStatus.AWAITING_STAKES,
    WagerStatus.STAKED,
    WagerStatus.SETTLING,
  ];

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    private readonly jwtService: JwtService,
    private readonly authTokenService: AuthTokenService,
    private readonly configService: ConfigService,
    @Inject(STELLAR_CONFIG) private readonly stellarConfig: StellarConfig,
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
  ) {
    // The SEP-10 signing key identifies this server to wallets. It is separate
    // from the resolver key so that rotating one does not invalidate the other.
    const secret =
      this.configService.get<string>('STELLAR_WEB_AUTH_SECRET') ??
      this.configService.get<string>('STELLAR_RESOLVER_SECRET');

    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error(
        'STELLAR_WEB_AUTH_SECRET (or STELLAR_RESOLVER_SECRET) must be set when NODE_ENV=production; ' +
          'an ephemeral key would differ on every instance.',
      );
    }

    if (!secret) {
      // Generating an ephemeral key keeps development working without secrets,
      // at the cost of invalidating outstanding challenges on restart.
      this.serverKeypair = Keypair.random();
      this.logger.warn(
        'No STELLAR_WEB_AUTH_SECRET configured; using an ephemeral signing key. ' +
          'Challenges will not survive a restart. Set one before deploying.',
      );
    } else {
      if (!StrKey.isValidEd25519SecretSeed(secret)) {
        throw new Error(
          'STELLAR_WEB_AUTH_SECRET is not a valid Stellar secret seed (expected an S... key).',
        );
      }
      this.serverKeypair = Keypair.fromSecret(secret);
    }
  }

  /** The public key wallets should expect to have signed their challenge. */
  get serverAccountId(): string {
    return this.serverKeypair.publicKey();
  }

  /** Builds a SEP-10 challenge for an account to sign. */
  buildChallenge(account: string): StellarChallenge {
    const challengeXdr = WebAuth.buildChallengeTx(
      this.serverKeypair,
      account,
      this.stellarConfig.webAuthDomain,
      CHALLENGE_TIMEOUT_SECONDS,
      this.stellarConfig.networkPassphrase,
      this.stellarConfig.webAuthDomain,
    );

    return {
      transaction: challengeXdr,
      network_passphrase: this.stellarConfig.networkPassphrase,
    };
  }

  /**
   * Verifies a signed challenge and returns the account that signed it.
   *
   * Throws rather than returning a flag: every caller treats a failed challenge
   * as an authentication failure, and a boolean invites forgetting to check it.
   */
  verifyChallenge(signedTransaction: string): string {
    try {
      const { clientAccountID } = WebAuth.readChallengeTx(
        signedTransaction,
        this.serverAccountId,
        this.stellarConfig.networkPassphrase,
        this.stellarConfig.webAuthDomain,
        this.stellarConfig.webAuthDomain,
      );

      // readChallengeTx validates the envelope's shape; this checks that the
      // client's key actually signed it.
      WebAuth.verifyChallengeTxSigners(
        signedTransaction,
        this.serverAccountId,
        this.stellarConfig.networkPassphrase,
        [clientAccountID],
        this.stellarConfig.webAuthDomain,
        this.stellarConfig.webAuthDomain,
      );

      return clientAccountID;
    } catch (error) {
      this.logger.debug(
        `Challenge verification failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException(
        `Invalid Stellar challenge: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Marks a signed challenge as used, rejecting any replay. The nonce comes
   * from the challenge's manage_data value and is remembered for the challenge
   * lifetime, after which the time bounds reject it anyway.
   */
  private async consumeChallenge(signedTransaction: string): Promise<void> {
    const { tx, clientAccountID } = WebAuth.readChallengeTx(
      signedTransaction,
      this.serverAccountId,
      this.stellarConfig.networkPassphrase,
      this.stellarConfig.webAuthDomain,
      this.stellarConfig.webAuthDomain,
    );
    const op = tx.operations[0] as { value?: Buffer | string };
    const nonce = op?.value ? op.value.toString() : tx.hash().toString('hex');
    const key = `sep10:nonce:${clientAccountID}:${nonce}`;
    const ttlMs = (CHALLENGE_TIMEOUT_SECONDS + 60) * 1000;

    let seen: boolean;
    if (this.cache) {
      seen = (await this.cache.get(key)) != null;
      if (!seen) await this.cache.set(key, 1, ttlMs);
    } else {
      const now = Date.now();
      for (const [k, exp] of this.usedNonces) {
        if (exp < now) this.usedNonces.delete(k);
      }
      seen = this.usedNonces.has(key);
      if (!seen) this.usedNonces.set(key, now + ttlMs);
    }

    if (seen) {
      throw new UnauthorizedException(
        'Stellar challenge has already been used',
      );
    }
  }

  /**
   * Links a verified wallet to an existing account.
   *
   * An address can back only one account: allowing two would make a payout
   * address ambiguous, and the winner of a pot has to be a single user.
   */
  async linkWallet(
    userId: string,
    signedTransaction: string,
  ): Promise<{ stellarAddress: string; verifiedAt: Date }> {
    await this.assertNoActiveWager(
      userId,
      'Cannot relink a Stellar wallet while you have an active wager',
    );

    const address = this.verifyChallenge(signedTransaction);
    await this.consumeChallenge(signedTransaction);

    const existing = await this.userRepository.findOne({
      where: { stellarAddress: address },
    });

    if (existing && existing.id !== userId) {
      throw new ConflictException(
        'That Stellar address is already linked to another LyricsFlip account',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException(`User with ID ${userId} not found`);
    }

    user.stellarAddress = address;
    user.stellarAddressVerifiedAt = new Date();
    await this.userRepository.save(user);

    this.logger.log(`Linked ${address} to user ${userId}`);

    return {
      stellarAddress: address,
      verifiedAt: user.stellarAddressVerifiedAt,
    };
  }

  /**
   * Authenticates with a wallet alone and issues the same JWT the password
   * flow does, so every downstream guard behaves identically.
   */
  async loginWithWallet(
    signedTransaction: string,
  ): Promise<AuthResult> {
    const address = this.verifyChallenge(signedTransaction);
    await this.consumeChallenge(signedTransaction);

    const user = await this.userRepository.findOne({
      where: { stellarAddress: address },
    });

    if (!user) {
      throw new UnauthorizedException(
        `No LyricsFlip account is linked to ${address}. ` +
          'Sign in with your password once and link the wallet first.',
      );
    }

    this.authTokenService.assertActive(user);

    user.lastLoginAt = new Date();
    user.stellarAddressVerifiedAt = new Date();
    await this.userRepository.save(user);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };

    const { passwordHash: _passwordHash, ...userWithoutPassword } = user;

    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
    return this.authTokenService.issueToken(user);
  }

  /** Removes the wallet link, e.g. when a player rotates keys. */
  async unlinkWallet(userId: string): Promise<void> {
    await this.assertNoActiveWager(
      userId,
      'Cannot unlink your Stellar wallet while you have an active wager',
    );

    await this.userRepository.update(
      { id: userId },
      { stellarAddress: null, stellarAddressVerifiedAt: null },
    );
  }

  /**
   * Refuses to touch the wallet link while a pot is open.
   *
   * A payout goes to whichever address staked the pot (see
   * {@link StellarTokenService.releaseToWinner}), so unlinking mid-match only
   * strands the payout; relinking a different address would move where it
   * goes. Blocking both while a wager is in flight keeps the address the
   * contract pays lined up with the address the player controls.
   */
  private async assertNoActiveWager(
    userId: string,
    message: string,
  ): Promise<void> {
    const activeWager = await this.wagerRepository.findOne({
      where: [
        { playerAId: userId, status: In(StellarAuthService.ACTIVE_WAGER_STATUSES) },
        { playerBId: userId, status: In(StellarAuthService.ACTIVE_WAGER_STATUSES) },
      ],
    });

    if (activeWager) {
      throw new ConflictException(
        `${message} (wager ${activeWager.id} is ${activeWager.status})`,
      );
    }
  }
}
