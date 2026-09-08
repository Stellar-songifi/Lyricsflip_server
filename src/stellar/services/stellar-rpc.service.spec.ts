import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  StrKey,
  rpc,
} from '@stellar/stellar-sdk';
import { StellarRpcService } from './stellar-rpc.service';
import type { StellarConfig } from '../stellar.config';

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
} as StellarConfig;

/** A real, signable transaction, so hashes and XDR are genuine. */
const buildTransaction = (source: Keypair): Transaction =>
  new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(180)
    .build();

describe('StellarRpcService', () => {
  let service: StellarRpcService;
  let source: Keypair;
  let transaction: Transaction;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    source = Keypair.random();
    transaction = buildTransaction(source);
    service = new StellarRpcService(config);
  });

  afterEach(() => jest.restoreAllMocks());

  const hashOf = (tx: Transaction) => Buffer.from(tx.hash()).toString('hex');

  describe('loadAccount', () => {
    it('returns the account when the network knows it', async () => {
      const account = new Account(source.publicKey(), '7');
      jest.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(account);

      expect(await service.loadAccount(source.publicKey())).toBe(account);
    });

    it('explains that an unfunded test account looks the same as a missing one', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockRejectedValue(new Error('Account not found'));

      await expect(service.loadAccount(source.publicKey())).rejects.toThrow(
        /may simply not be funded yet/,
      );
      await expect(service.loadAccount(source.publicKey())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('toUnsigned / fromXdr', () => {
    it('serialises a transaction with the network it must be signed against', () => {
      const unsigned = service.toUnsigned(transaction);

      expect(unsigned.networkPassphrase).toBe(Networks.TESTNET);
      expect(unsigned.xdr).toBe(transaction.toXDR());
      expect(unsigned.hash).toBe(hashOf(transaction));
    });

    it('reports the hash as hex, not as a stringified byte array', () => {
      expect(service.toUnsigned(transaction).hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('round-trips a transaction through XDR unchanged', () => {
      const restored = service.fromXdr(service.toUnsigned(transaction).xdr);

      expect(hashOf(restored)).toBe(hashOf(transaction));
    });

    it('keeps the hash stable once a wallet adds its signature', () => {
      // The caller records this hash before the player signs, so a signature
      // must not change it.
      const before = service.toUnsigned(transaction).hash;
      transaction.sign(source);

      expect(hashOf(transaction)).toBe(before);
    });
  });

  describe('signAndSubmit', () => {
    it('applies every signer before submitting', async () => {
      const send = jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
          status: 'PENDING',
          hash: hashOf(transaction),
        } as rpc.Api.SendTransactionResponse);
      jest.spyOn(service, 'waitForConfirmation').mockResolvedValue({
        hash: hashOf(transaction),
        confirmed: true,
      });

      const second = Keypair.random();
      await service.signAndSubmit(transaction, [source, second]);

      expect(transaction.signatures).toHaveLength(2);
      expect(send).toHaveBeenCalledWith(transaction);
    });
  });

  describe('submit', () => {
    const pending = (hash: string) =>
      ({ status: 'PENDING', hash }) as rpc.Api.SendTransactionResponse;

    it('waits for confirmation rather than trusting PENDING', async () => {
      // sendTransaction returns as soon as the transaction is queued, and a
      // queued transaction can still fail.
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue(pending(hashOf(transaction)));
      const wait = jest
        .spyOn(service, 'waitForConfirmation')
        .mockResolvedValue({ hash: hashOf(transaction), confirmed: true });

      const result = await service.submit(transaction);

      expect(wait).toHaveBeenCalledWith(hashOf(transaction));
      expect(result.confirmed).toBe(true);
    });

    it('reports a network rejection without confirming', async () => {
      jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue({
        status: 'ERROR',
        hash: hashOf(transaction),
        errorResult: { code: 'tx_insufficient_fee' },
      } as unknown as rpc.Api.SendTransactionResponse);
      const wait = jest.spyOn(service, 'waitForConfirmation');

      const result = await service.submit(transaction);

      expect(result.confirmed).toBe(false);
      expect(result.error).toMatch(/Network rejected the transaction/);
      expect(result.error).toContain('tx_insufficient_fee');
      expect(wait).not.toHaveBeenCalled();
    });

    it('polls a DUPLICATE instead of failing, since the flows are idempotent', async () => {
      jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue({
        status: 'DUPLICATE',
        hash: hashOf(transaction),
      } as unknown as rpc.Api.SendTransactionResponse);
      const wait = jest
        .spyOn(service, 'waitForConfirmation')
        .mockResolvedValue({ hash: hashOf(transaction), confirmed: true });

      const result = await service.submit(transaction);

      expect(wait).toHaveBeenCalledWith(hashOf(transaction));
      expect(result.confirmed).toBe(true);
    });

    it('returns the hash even when submission throws, so it can be reconciled', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockRejectedValue(new Error('connection reset'));

      const result = await service.submit(transaction);

      expect(result).toMatchObject({
        hash: hashOf(transaction),
        confirmed: false,
      });
      expect(result.error).toMatch(/Submission failed: connection reset/);
    });
  });

  describe('waitForConfirmation', () => {
    it('confirms a successful transaction with its ledger', async () => {
      jest.spyOn(rpc.Server.prototype, 'pollTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 4242,
      } as rpc.Api.GetTransactionResponse);

      expect(await service.waitForConfirmation('abc')).toEqual({
        hash: 'abc',
        confirmed: true,
        ledger: 4242,
        returnValue: undefined,
      });
    });

    it('decodes the contract return value when there is one', async () => {
      jest.spyOn(rpc.Server.prototype, 'pollTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 1,
        returnValue: nativeToScVal(210000000n, { type: 'i128' }),
      } as rpc.Api.GetTransactionResponse);

      const result = await service.waitForConfirmation('abc');

      expect(result.returnValue).toBe(210000000n);
    });

    it('reports an on-chain failure as failed', async () => {
      jest.spyOn(rpc.Server.prototype, 'pollTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
        ledger: 7,
        resultXdr: { toXDR: () => 'AAAAAA==' },
      } as unknown as rpc.Api.GetTransactionResponse);

      const result = await service.waitForConfirmation('abc');

      expect(result).toMatchObject({ confirmed: false, ledger: 7 });
      expect(result.error).toMatch(/Transaction failed on-chain/);
    });

    it('leaves an unfound transaction for reconciliation, not marked failed', async () => {
      // It may still be included; treating it as failed is how a pot gets paid
      // twice.
      jest.spyOn(rpc.Server.prototype, 'pollTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as rpc.Api.GetTransactionResponse);

      const result = await service.waitForConfirmation('abc');

      expect(result.confirmed).toBe(false);
      expect(result.error).toMatch(/awaiting reconciliation/);
    });

    it('reports a polling error against the same hash', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'pollTransaction')
        .mockRejectedValue(new Error('timeout'));

      const result = await service.waitForConfirmation('abc');

      expect(result).toMatchObject({ hash: 'abc', confirmed: false });
      expect(result.error).toMatch(/Could not confirm transaction: timeout/);
    });
  });

  describe('lookupTransaction', () => {
    it('confirms a transaction that has since succeeded', async () => {
      jest.spyOn(rpc.Server.prototype, 'getTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 99,
      } as rpc.Api.GetTransactionResponse);

      expect(await service.lookupTransaction('abc')).toMatchObject({
        confirmed: true,
        ledger: 99,
      });
    });

    it('reports a non-success status without throwing', async () => {
      jest.spyOn(rpc.Server.prototype, 'getTransaction').mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as rpc.Api.GetTransactionResponse);

      const result = await service.lookupTransaction('abc');

      expect(result.confirmed).toBe(false);
      expect(result.error).toMatch(/Transaction status: NOT_FOUND/);
    });

    it('reports a lookup failure without throwing, so a sweep continues', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockRejectedValue(new Error('502 bad gateway'));

      const result = await service.lookupTransaction('abc');

      expect(result.confirmed).toBe(false);
      expect(result.error).toMatch(/Lookup failed: 502 bad gateway/);
    });
  });

  describe('readContract', () => {
    const contractId = StrKey.encodeContract(Keypair.random().rawPublicKey());

    it('surfaces a simulation error', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({
          error: 'contract panicked',
        } as unknown as rpc.Api.SimulateTransactionResponse);

      await expect(
        service.readContract(source.publicKey(), contractId, 'balance', []),
      ).rejects.toThrow(/Read of balance .* failed: contract panicked/);
    });

    it('rejects a simulation that returned no value', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({
          latestLedger: 1,
          transactionData: {},
        } as unknown as rpc.Api.SimulateTransactionResponse);

      await expect(
        service.readContract(source.publicKey(), contractId, 'balance', []),
      ).rejects.toThrow(/returned no value/);
    });

    it('never submits anything, so a read cannot cost a fee', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({
          error: 'nope',
        } as unknown as rpc.Api.SimulateTransactionResponse);
      const send = jest.spyOn(rpc.Server.prototype, 'sendTransaction');

      await expect(
        service.readContract(source.publicKey(), contractId, 'balance', []),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('buildInvocation', () => {
    it('translates a simulation failure into a service error naming the method', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue(new Account(source.publicKey(), '1'));
      jest
        .spyOn(rpc.Server.prototype, 'prepareTransaction')
        .mockRejectedValue(new Error('insufficient balance'));

      await expect(
        service.buildInvocation(
          source.publicKey(),
          StrKey.encodeContract(Keypair.random().rawPublicKey()),
          'stake',
          [],
        ),
      ).rejects.toThrow(/Simulation of stake .* failed: insufficient balance/);
    });
  });

  describe('isHealthy', () => {
    it('is true only when the endpoint reports healthy', async () => {
      const health = jest.spyOn(rpc.Server.prototype, 'getHealth');

      health.mockResolvedValue({
        status: 'healthy',
      } as rpc.Api.GetHealthResponse);
      expect(await service.isHealthy()).toBe(true);

      health.mockResolvedValue({
        status: 'unhealthy',
      } as unknown as rpc.Api.GetHealthResponse);
      expect(await service.isHealthy()).toBe(false);
    });

    it('is false rather than throwing when the endpoint is unreachable', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'getHealth')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      expect(await service.isHealthy()).toBe(false);
    });
  });
});
