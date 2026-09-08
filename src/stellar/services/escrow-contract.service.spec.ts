import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  Keypair,
  StrKey,
  Transaction,
  scValToNative,
} from '@stellar/stellar-sdk';
import { EscrowContractService, PotStatus } from './escrow-contract.service';
import { StellarRpcService, SubmitResult } from './stellar-rpc.service';
import type { StellarConfig } from '../stellar.config';

const SESSION_ID = '3f1e4b2a-9c8d-4e7f-a1b2-c3d4e5f60718';

describe('EscrowContractService', () => {
  let service: EscrowContractService;
  let rpc: jest.Mocked<
    Pick<
      StellarRpcService,
      | 'buildInvocation'
      | 'signAndSubmit'
      | 'readContract'
      | 'toUnsigned'
      | 'fromXdr'
      | 'submit'
    >
  >;
  let config: StellarConfig;
  let resolver: Keypair;
  let playerA: string;
  let playerB: string;

  const confirmed: SubmitResult = {
    hash: 'abc123',
    confirmed: true,
    ledger: 42,
  };
  const preparedTransaction = { prepared: true } as unknown as Transaction;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    resolver = Keypair.random();
    playerA = Keypair.random().publicKey();
    playerB = Keypair.random().publicKey();
    config = {
      escrowContractId: StrKey.encodeContract(Keypair.random().rawPublicKey()),
      tokenContractId: StrKey.encodeContract(Keypair.random().rawPublicKey()),
      resolverPublicKey: resolver.publicKey(),
    } as StellarConfig;

    rpc = {
      buildInvocation: jest.fn().mockResolvedValue(preparedTransaction),
      signAndSubmit: jest.fn().mockResolvedValue(confirmed),
      readContract: jest.fn(),
      toUnsigned: jest.fn(),
      fromXdr: jest.fn(),
      submit: jest.fn().mockResolvedValue(confirmed),
    };

    service = new EscrowContractService(
      config,
      rpc as unknown as StellarRpcService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** Decodes the ScVal arguments a call was built with. */
  const argsOf = (call: number = 0) =>
    rpc.buildInvocation.mock.calls[call][3].map((arg) => scValToNative(arg));

  describe('session key encoding', () => {
    it('encodes the session UUID as the contract 16-byte key', async () => {
      await service.openPot(resolver, SESSION_ID, playerA, playerB, '10');

      const sessionKey = argsOf()[0] as Buffer;
      expect(Buffer.isBuffer(sessionKey)).toBe(true);
      expect(sessionKey).toHaveLength(16);
      expect(sessionKey.toString('hex')).toBe(SESSION_ID.replace(/-/g, ''));
    });

    it('accepts a UUID without dashes', async () => {
      await service.refund(resolver, SESSION_ID.replace(/-/g, ''));

      expect((argsOf()[0] as Buffer).toString('hex')).toBe(
        SESSION_ID.replace(/-/g, ''),
      );
    });

    it('rejects a session ID that is not a UUID', async () => {
      // A truncated or non-hex key would silently collide with another pot.
      await expect(service.refund(resolver, 'session-1')).rejects.toThrow(
        /is not a UUID/,
      );

      await expect(
        service.refund(resolver, 'zzzzzzzz-9c8d-4e7f-a1b2-c3d4e5f60718'),
      ).rejects.toThrow(/is not a UUID/);
    });
  });

  describe('openPot', () => {
    it('invokes open_pot as the resolver with both players and the stake', async () => {
      const result = await service.openPot(
        resolver,
        SESSION_ID,
        playerA,
        playerB,
        '105000000',
      );

      expect(rpc.buildInvocation).toHaveBeenCalledWith(
        resolver.publicKey(),
        config.escrowContractId,
        'open_pot',
        expect.any(Array),
      );

      const [, a, b, stake] = argsOf();
      expect(a).toBe(playerA);
      expect(b).toBe(playerB);
      expect(stake).toBe(105000000n);
      expect(result).toEqual(confirmed);
    });

    it('signs with the resolver key', async () => {
      await service.openPot(resolver, SESSION_ID, playerA, playerB, '10');

      expect(rpc.signAndSubmit).toHaveBeenCalledWith(preparedTransaction, [
        resolver,
      ]);
    });

    it('rejects a stake that is not a whole number of stroops', async () => {
      await expect(
        service.openPot(resolver, SESSION_ID, playerA, playerB, '10.5'),
      ).rejects.toThrow(/expected a whole number/);
    });
  });

  describe('stake', () => {
    it('builds the stake transaction from the given source account', async () => {
      await service.buildStake(playerA, SESSION_ID, playerA);

      expect(rpc.buildInvocation).toHaveBeenCalledWith(
        playerA,
        config.escrowContractId,
        'stake',
        expect.any(Array),
      );
      expect(argsOf()[1]).toBe(playerA);
    });

    it('never submits a stake itself, since the player must authorise it', async () => {
      await service.buildStake(playerA, SESSION_ID, playerA);

      expect(rpc.signAndSubmit).not.toHaveBeenCalled();
      expect(rpc.submit).not.toHaveBeenCalled();
    });

    it('serialises an unsigned stake for the player wallet', async () => {
      const unsigned = {
        xdr: 'AAAA...',
        networkPassphrase: 'Test SDF Network ; September 2015',
        hash: 'deadbeef',
      };
      rpc.toUnsigned.mockReturnValue(unsigned);

      const result = await service.buildUnsignedStake(SESSION_ID, playerA);

      // The player pays their own fee, so they are the source account too.
      expect(rpc.buildInvocation).toHaveBeenCalledWith(
        playerA,
        config.escrowContractId,
        'stake',
        expect.any(Array),
      );
      expect(rpc.toUnsigned).toHaveBeenCalledWith(preparedTransaction);
      expect(result).toEqual(unsigned);
    });

    it('submits a wallet-signed stake without re-signing it', async () => {
      const signedTransaction = { signed: true } as unknown as Transaction;
      rpc.fromXdr.mockReturnValue(signedTransaction);

      const result = await service.submitSignedStake('AAAA...');

      expect(rpc.fromXdr).toHaveBeenCalledWith('AAAA...');
      expect(rpc.submit).toHaveBeenCalledWith(signedTransaction);
      expect(rpc.signAndSubmit).not.toHaveBeenCalled();
      expect(result).toEqual(confirmed);
    });
  });

  describe('resolve and refund', () => {
    it('resolves to the winner as the resolver', async () => {
      const winner = Keypair.random().publicKey();

      await service.resolve(resolver, SESSION_ID, winner);

      expect(rpc.buildInvocation).toHaveBeenCalledWith(
        resolver.publicKey(),
        config.escrowContractId,
        'resolve',
        expect.any(Array),
      );
      expect(argsOf()[1]).toBe(winner);
      expect(rpc.signAndSubmit).toHaveBeenCalledWith(preparedTransaction, [
        resolver,
      ]);
    });

    it('refunds with the session as the only argument', async () => {
      await service.refund(resolver, SESSION_ID);

      expect(rpc.buildInvocation).toHaveBeenCalledWith(
        resolver.publicKey(),
        config.escrowContractId,
        'refund',
        expect.any(Array),
      );
      expect(argsOf()).toHaveLength(1);
    });
  });

  describe('getPot', () => {
    it('maps the contract snake_case fields onto the typed pot', async () => {
      rpc.readContract.mockResolvedValue({
        player_a: playerA,
        player_b: playerB,
        stake: 105000000n,
        funded_a: true,
        funded_b: false,
        status: 'Funded',
      });

      expect(await service.getPot(SESSION_ID)).toEqual({
        playerA,
        playerB,
        stake: '105000000',
        fundedA: true,
        fundedB: false,
        status: PotStatus.FUNDED,
      });
    });

    it('reads the pot without submitting a transaction', async () => {
      rpc.readContract.mockResolvedValue({ status: 'Open' });

      await service.getPot(SESSION_ID);

      expect(rpc.readContract).toHaveBeenCalledWith(
        config.resolverPublicKey,
        config.escrowContractId,
        'get_pot',
        expect.any(Array),
      );
      expect(rpc.signAndSubmit).not.toHaveBeenCalled();
    });

    it('returns null when the pot does not exist', async () => {
      rpc.readContract.mockResolvedValue(null);

      expect(await service.getPot(SESSION_ID)).toBeNull();
    });

    it('returns null rather than throwing when the read fails', async () => {
      // getPot is the reconciliation path; an unreachable RPC must not turn a
      // settled wager into an exception.
      rpc.readContract.mockRejectedValue(new Error('rpc unreachable'));

      expect(await service.getPot(SESSION_ID)).toBeNull();
    });
  });

  describe('getTokenBalance', () => {
    it('reads the balance as the address being queried', async () => {
      rpc.readContract.mockResolvedValue(105000000n);

      const balance = await service.getTokenBalance(playerA);

      expect(rpc.readContract).toHaveBeenCalledWith(
        playerA,
        config.tokenContractId,
        'balance',
        expect.any(Array),
      );
      expect(balance).toBe('105000000');
    });

    it('accepts the numeric shapes the SDK may decode an i128 into', async () => {
      for (const [raw, expected] of [
        [105000000n, '105000000'],
        [105000000, '105000000'],
        ['105000000', '105000000'],
      ] as [unknown, string][]) {
        rpc.readContract.mockResolvedValue(raw);
        expect(await service.getTokenBalance(playerA)).toBe(expected);
      }
    });

    it('treats an absent balance as zero', async () => {
      rpc.readContract.mockResolvedValue(null);
      expect(await service.getTokenBalance(playerA)).toBe('0');

      rpc.readContract.mockResolvedValue(undefined);
      expect(await service.getTokenBalance(playerA)).toBe('0');
    });

    it('refuses to stringify an unexpected return shape into a balance', async () => {
      // String({}) is "[object Object]", which would sail through as a balance.
      rpc.readContract.mockResolvedValue({ unexpected: true });

      await expect(service.getTokenBalance(playerA)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
