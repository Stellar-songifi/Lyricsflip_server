import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import { User } from '../../users/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { Role } from '../roles/role.enum';
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

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(STELLAR_CONFIG) private readonly stellarConfig: StellarConfig,
  ) {
    // The SEP-10 signing key identifies this server to wallets. It is separate
    // from the resolver key so that rotating one does not invalidate the other.
    const secret =
      this.configService.get<string>('STELLAR_WEB_AUTH_SECRET') ??
      this.configService.get<string>('STELLAR_RESOLVER_SECRET');

    if (!secret) {
      // Generating an ephemeral key keeps development working without secrets,
      // at the cost of invalidating outstanding challenges on restart.
      this.serverKeypair = Keypair.random();
      this.logger.warn(
        'No STELLAR_WEB_AUTH_SECRET configured; using an ephemeral signing key. ' +
          'Challenges will not survive a restart. Set one before deploying.',
      );
    } else {
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
   * Links a verified wallet to an existing account.
   *
   * An address can back only one account: allowing two would make a payout
   * address ambiguous, and the winner of a pot has to be a single user.
   */
  async linkWallet(
    userId: string,
    signedTransaction: string,
  ): Promise<{ stellarAddress: string; verifiedAt: Date }> {
    const address = this.verifyChallenge(signedTransaction);

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
  ): Promise<{ accessToken: string; user: Partial<User> }> {
    const address = this.verifyChallenge(signedTransaction);

    const user = await this.userRepository.findOne({
      where: { stellarAddress: address },
    });

    if (!user) {
      throw new UnauthorizedException(
        `No LyricsFlip account is linked to ${address}. ` +
          'Sign in with your password once and link the wallet first.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

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
  }

  /** Removes the wallet link, e.g. when a player rotates keys. */
  async unlinkWallet(userId: string): Promise<void> {
    await this.userRepository.update(
      { id: userId },
      { stellarAddress: null, stellarAddressVerifiedAt: null },
    );
  }
}
