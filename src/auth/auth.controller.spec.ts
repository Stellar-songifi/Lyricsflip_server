import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StellarAuthService } from './services/stellar-auth.service';
import { User } from '../users/entities/user.entity';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'signup' | 'login'>>;
  let stellarAuthService: jest.Mocked<
    Pick<
      StellarAuthService,
      'buildChallenge' | 'loginWithWallet' | 'linkWallet' | 'unlinkWallet'
    >
  > & { serverAccountId: string };

  const SERVER_ACCOUNT =
    'GBB3MXLPWTKVFS5ROB3OGGNPXXRU5N7INABOUJ3O77JR63R36ZTGYAFT';
  const PLAYER_ACCOUNT =
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      login: jest.fn(),
    };
    stellarAuthService = {
      buildChallenge: jest.fn(),
      loginWithWallet: jest.fn(),
      linkWallet: jest.fn(),
      unlinkWallet: jest.fn().mockResolvedValue(undefined),
      serverAccountId: SERVER_ACCOUNT,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: StellarAuthService, useValue: stellarAuthService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('password flow', () => {
    it('delegates signup to the auth service', async () => {
      const dto = {
        username: 'ada',
        email: 'ada@example.com',
        password: 'sup3rsecret',
      };
      authService.signup.mockResolvedValue({ accessToken: 'jwt' } as never);

      await expect(controller.signup(dto as never)).resolves.toEqual({
        accessToken: 'jwt',
      });
      expect(authService.signup).toHaveBeenCalledWith(dto);
    });

    it('delegates login to the auth service', async () => {
      const dto = { email: 'ada@example.com', password: 'sup3rsecret' };
      authService.login.mockResolvedValue({ accessToken: 'jwt' } as never);

      await expect(controller.login(dto as never)).resolves.toEqual({
        accessToken: 'jwt',
      });
      expect(authService.login).toHaveBeenCalledWith(dto);
    });
  });

  describe('stellar challenge', () => {
    it('returns the challenge alongside the account that signed it', () => {
      stellarAuthService.buildChallenge.mockReturnValue({
        transaction: 'base64-xdr',
        network_passphrase: 'Test SDF Network ; September 2015',
      });

      expect(controller.challenge({ account: PLAYER_ACCOUNT })).toEqual({
        transaction: 'base64-xdr',
        network_passphrase: 'Test SDF Network ; September 2015',
        server_account_id: SERVER_ACCOUNT,
      });
      expect(stellarAuthService.buildChallenge).toHaveBeenCalledWith(
        PLAYER_ACCOUNT,
      );
    });
  });

  describe('stellar login', () => {
    it('exchanges a signed challenge for a token', async () => {
      stellarAuthService.loginWithWallet.mockResolvedValue({
        accessToken: 'jwt',
      } as never);

      await expect(
        controller.stellarLogin({ transaction: 'signed-xdr' }),
      ).resolves.toEqual({ accessToken: 'jwt' });
      expect(stellarAuthService.loginWithWallet).toHaveBeenCalledWith(
        'signed-xdr',
      );
    });

    it('surfaces a rejected signature to the caller', async () => {
      const failure = new Error('invalid signature');
      stellarAuthService.loginWithWallet.mockRejectedValue(failure);

      await expect(
        controller.stellarLogin({ transaction: 'tampered-xdr' }),
      ).rejects.toThrow(failure);
    });
  });

  describe('wallet linking', () => {
    const user = {
      id: 'user-1',
      stellarAddress: PLAYER_ACCOUNT,
      stellarAddressVerifiedAt: new Date('2026-01-02T03:04:05.000Z'),
    } as User;

    it('links a wallet on behalf of the signed-in user', async () => {
      stellarAuthService.linkWallet.mockResolvedValue({
        stellarAddress: PLAYER_ACCOUNT,
      } as never);

      await expect(
        controller.linkWallet(user, { transaction: 'signed-xdr' }),
      ).resolves.toEqual({ stellarAddress: PLAYER_ACCOUNT });
      expect(stellarAuthService.linkWallet).toHaveBeenCalledWith(
        'user-1',
        'signed-xdr',
      );
    });

    it('returns the linked wallet and when it was verified', () => {
      expect(controller.getWallet(user)).toEqual({
        stellarAddress: PLAYER_ACCOUNT,
        verifiedAt: user.stellarAddressVerifiedAt,
      });
    });

    it('returns nulls when no wallet is linked', () => {
      expect(controller.getWallet({ id: 'user-2' } as User)).toEqual({
        stellarAddress: null,
        verifiedAt: null,
      });
    });

    it('unlinks the wallet and confirms it', async () => {
      await expect(controller.unlinkWallet(user)).resolves.toEqual({
        message: 'Stellar wallet unlinked',
      });
      expect(stellarAuthService.unlinkWallet).toHaveBeenCalledWith('user-1');
    });
  });
});
