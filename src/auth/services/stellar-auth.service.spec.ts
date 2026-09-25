import {
  BadRequestException,
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Keypair, Networks, Transaction, WebAuth } from '@stellar/stellar-sdk';
import { Repository } from 'typeorm';
import { StellarAuthService } from './stellar-auth.service';
import { User } from '../../users/entities/user.entity';
import type { StellarConfig } from '../../stellar/stellar.config';

const stellarConfig = {
  networkPassphrase: Networks.TESTNET,
  webAuthDomain: 'lyricsflip.test',
} as StellarConfig;

const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('StellarAuthService', () => {
  let service: StellarAuthService;
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let serverSecret: string;
  let wallet: Keypair;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    serverSecret = Keypair.random().secret();
    wallet = Keypair.random();

    userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((user) => Promise.resolve(user)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    jwtService = { sign: jest.fn().mockReturnValue('a.jwt.token') };

    service = new StellarAuthService(
      userRepository as unknown as Repository<User>,
      jwtService as unknown as JwtService,
      configOf({ STELLAR_WEB_AUTH_SECRET: serverSecret }),
      stellarConfig,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** Signs a challenge the way a wallet would. */
  const signChallenge = (challengeXdr: string, signer: Keypair): string => {
    const transaction = new Transaction(challengeXdr, Networks.TESTNET);
    transaction.sign(signer);
    return transaction.toXDR();
  };

  const signedChallengeFor = (signer: Keypair, account = signer) =>
    signChallenge(
      service.buildChallenge(account.publicKey()).transaction,
      signer,
    );

  describe('server key', () => {
    it('uses the configured web-auth secret', () => {
      expect(service.serverAccountId).toBe(
        Keypair.fromSecret(serverSecret).publicKey(),
      );
    });

    it('falls back to the resolver key when no web-auth secret is set', () => {
      const resolverSecret = Keypair.random().secret();
      const fallback = new StellarAuthService(
        userRepository as unknown as Repository<User>,
        jwtService as unknown as JwtService,
        configOf({ STELLAR_RESOLVER_SECRET: resolverSecret }),
        stellarConfig,
      );

      expect(fallback.serverAccountId).toBe(
        Keypair.fromSecret(resolverSecret).publicKey(),
      );
    });

    it('warns when it has to generate an ephemeral key', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      new StellarAuthService(
        userRepository as unknown as Repository<User>,
        jwtService as unknown as JwtService,
        configOf({}),
        stellarConfig,
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ephemeral signing key'),
      );
    });
  });

  describe('buildChallenge', () => {
    it('issues a challenge the wallet can read back', () => {
      const challenge = service.buildChallenge(wallet.publicKey());

      expect(challenge.network_passphrase).toBe(Networks.TESTNET);

      const { clientAccountID } = WebAuth.readChallengeTx(
        challenge.transaction,
        service.serverAccountId,
        Networks.TESTNET,
        stellarConfig.webAuthDomain,
        stellarConfig.webAuthDomain,
      );
      expect(clientAccountID).toBe(wallet.publicKey());
    });

    it('builds a challenge that can never be submitted to the network', () => {
      // SEP-10 challenges carry sequence number 0, so no ledger will accept
      // them however they are signed.
      const challenge = service.buildChallenge(wallet.publicKey());
      const transaction = new Transaction(
        challenge.transaction,
        Networks.TESTNET,
      );

      expect(transaction.sequence).toBe('0');
    });

    it('signs the challenge with the server key', () => {
      const challenge = service.buildChallenge(wallet.publicKey());
      const transaction = new Transaction(
        challenge.transaction,
        Networks.TESTNET,
      );

      expect(transaction.signatures).toHaveLength(1);
    });

    it('rejects an account that is not a Stellar public key', () => {
      expect(() => service.buildChallenge('not-an-account')).toThrow();
    });
  });

  describe('verifyChallenge', () => {
    it('returns the account that signed the challenge', () => {
      expect(service.verifyChallenge(signedChallengeFor(wallet))).toBe(
        wallet.publicKey(),
      );
    });

    it('rejects a challenge the wallet never signed', () => {
      const challenge = service.buildChallenge(wallet.publicKey());

      expect(() => service.verifyChallenge(challenge.transaction)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a challenge signed by a different key', () => {
      // The whole point: holding someone else's address is not proof of it.
      const challenge = service.buildChallenge(wallet.publicKey());
      const impostor = Keypair.random();

      expect(() =>
        service.verifyChallenge(signChallenge(challenge.transaction, impostor)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a challenge issued by a different server', () => {
      const otherServer = new StellarAuthService(
        userRepository as unknown as Repository<User>,
        jwtService as unknown as JwtService,
        configOf({ STELLAR_WEB_AUTH_SECRET: Keypair.random().secret() }),
        stellarConfig,
      );
      const foreign = otherServer.buildChallenge(wallet.publicKey());

      expect(() =>
        service.verifyChallenge(signChallenge(foreign.transaction, wallet)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects malformed input rather than throwing a raw parse error', () => {
      expect(() => service.verifyChallenge('not-xdr')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('linkWallet', () => {
    const user = (over: Partial<User> = {}): Partial<User> => ({
      id: 'user-1',
      username: 'player',
      stellarAddress: null,
      stellarAddressVerifiedAt: null,
      ...over,
    });

    it('links a verified address and stamps the verification time', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(null) // no existing link for the address
        .mockResolvedValueOnce(user());

      const result = await service.linkWallet(
        'user-1',
        signedChallengeFor(wallet),
      );

      expect(result.stellarAddress).toBe(wallet.publicKey());
      expect(result.verifiedAt).toBeInstanceOf(Date);
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stellarAddress: wallet.publicKey(),
          stellarAddressVerifiedAt: expect.any(Date),
        }),
      );
    });

    it('refuses an address already linked to another account', async () => {
      // A payout address has to resolve to exactly one user.
      userRepository.findOne.mockResolvedValueOnce(
        user({ id: 'someone-else', stellarAddress: wallet.publicKey() }),
      );

      await expect(
        service.linkWallet('user-1', signedChallengeFor(wallet)),
      ).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('is idempotent when the address is already linked to the same user', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(
          user({ id: 'user-1', stellarAddress: wallet.publicKey() }),
        )
        .mockResolvedValueOnce(user({ id: 'user-1' }));

      await expect(
        service.linkWallet('user-1', signedChallengeFor(wallet)),
      ).resolves.toMatchObject({ stellarAddress: wallet.publicKey() });
    });

    it('rejects an unknown user', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.linkWallet('ghost', signedChallengeFor(wallet)),
      ).rejects.toThrow(BadRequestException);
    });

    it('never links a wallet on an unverified challenge', async () => {
      const challenge = service.buildChallenge(wallet.publicKey());

      await expect(
        service.linkWallet('user-1', challenge.transaction),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('loginWithWallet', () => {
    const linkedUser = (over: Partial<User> = {}): Partial<User> => ({
      id: 'user-1',
      email: 'player@lyricsflip.test',
      username: 'player',
      role: 'user' as User['role'],
      isActive: true,
      passwordHash: 'a-bcrypt-hash',
      stellarAddress: wallet.publicKey(),
      ...over,
    });

    it('issues a JWT for the account linked to the signing wallet', async () => {
      userRepository.findOne.mockResolvedValue(linkedUser());

      const result = await service.loginWithWallet(signedChallengeFor(wallet));

      expect(result.accessToken).toBe('a.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', username: 'player' }),
      );
    });

    it('never returns the password hash', async () => {
      userRepository.findOne.mockResolvedValue(linkedUser());

      const result = await service.loginWithWallet(signedChallengeFor(wallet));

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain('a-bcrypt-hash');
    });

    it('records the login and re-stamps verification', async () => {
      userRepository.findOne.mockResolvedValue(linkedUser());

      await service.loginWithWallet(signedChallengeFor(wallet));

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
          stellarAddressVerifiedAt: expect.any(Date),
        }),
      );
    });

    it('refuses a wallet no account is linked to', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.loginWithWallet(signedChallengeFor(wallet)),
      ).rejects.toThrow(/No LyricsFlip account is linked/);
    });

    it('refuses an inactive account', async () => {
      userRepository.findOne.mockResolvedValue(linkedUser({ isActive: false }));

      await expect(
        service.loginWithWallet(signedChallengeFor(wallet)),
      ).rejects.toThrow('User is inactive');
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('never issues a token on an unsigned challenge', async () => {
      const challenge = service.buildChallenge(wallet.publicKey());

      await expect(
        service.loginWithWallet(challenge.transaction),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('replay protection and key configuration', () => {
    it('rejects a challenge that was already exchanged', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'u1',
        isActive: true,
        email: 'a@b.c',
        username: 'u',
      });
      const signed = signedChallengeFor(wallet);
      await service.loginWithWallet(signed);
      await expect(service.loginWithWallet(signed)).rejects.toThrow(
        /already been used/,
      );
    });

    it('fails to boot in production without a web-auth secret', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(
          () =>
            new StellarAuthService(
              userRepository as unknown as Repository<User>,
              jwtService as unknown as JwtService,
              configOf({}),
              stellarConfig,
            ),
        ).toThrow(/STELLAR_WEB_AUTH_SECRET/);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it('rejects a malformed web-auth secret', () => {
      expect(
        () =>
          new StellarAuthService(
            userRepository as unknown as Repository<User>,
            jwtService as unknown as JwtService,
            configOf({ STELLAR_WEB_AUTH_SECRET: 'not-a-seed' }),
            stellarConfig,
          ),
      ).toThrow(/valid Stellar secret seed/);
    });
  });

  describe('unlinkWallet', () => {
    it('clears both the address and its verification stamp', async () => {
      await service.unlinkWallet('user-1');

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { stellarAddress: null, stellarAddressVerifiedAt: null },
      );
    });
  });
});
