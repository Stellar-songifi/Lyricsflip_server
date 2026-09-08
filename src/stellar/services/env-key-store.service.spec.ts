import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { EnvKeyStore, NonCustodialKeyStore } from './env-key-store.service';
import type { StellarConfig } from '../stellar.config';

const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const stellarConfigOf = (custodyMode: 'custodial' | 'non-custodial') =>
  ({ custodyMode }) as StellarConfig;

describe('EnvKeyStore', () => {
  const masterSeed = 'a-master-seed-for-tests';
  let resolverSecret: string;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    resolverSecret = Keypair.random().secret();
  });

  afterEach(() => jest.restoreAllMocks());

  const custodialStore = (over: Record<string, string | undefined> = {}) =>
    new EnvKeyStore(
      configOf({
        STELLAR_RESOLVER_SECRET: resolverSecret,
        STELLAR_CUSTODIAL_MASTER_SEED: masterSeed,
        ...over,
      }),
      stellarConfigOf('custodial'),
    );

  const nonCustodialStore = (over: Record<string, string | undefined> = {}) =>
    new EnvKeyStore(
      configOf({ STELLAR_RESOLVER_SECRET: resolverSecret, ...over }),
      stellarConfigOf('non-custodial'),
    );

  describe('construction', () => {
    it('requires a master seed in custodial mode', () => {
      expect(() =>
        custodialStore({ STELLAR_CUSTODIAL_MASTER_SEED: undefined }),
      ).toThrow(/STELLAR_CUSTODIAL_MASTER_SEED is required/);
    });

    it('does not require a master seed in non-custodial mode', () => {
      expect(() => nonCustodialStore()).not.toThrow();
    });

    it('warns that an env-derived key store is not for real value', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      custodialStore();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('KMS-backed key store'),
      );
    });

    it('reports its custody mode from the config', () => {
      expect(custodialStore().custodial).toBe(true);
      expect(nonCustodialStore().custodial).toBe(false);
    });
  });

  describe('getResolverKeypair', () => {
    it('returns the keypair for the configured secret', () => {
      expect(custodialStore().getResolverKeypair().publicKey()).toBe(
        Keypair.fromSecret(resolverSecret).publicKey(),
      );
    });

    it('throws a directive error when no resolver key is configured', () => {
      const store = nonCustodialStore({ STELLAR_RESOLVER_SECRET: undefined });

      expect(() => store.getResolverKeypair()).toThrow(
        /Set STELLAR_RESOLVER_SECRET/,
      );
    });
  });

  describe('custodial player keys', () => {
    it('derives a valid Stellar keypair for a user', async () => {
      const signer = await custodialStore().getPlayerSigner('user-1');

      expect(signer).not.toBeNull();
      expect(StrKey.isValidEd25519PublicKey(signer!.publicKey())).toBe(true);
    });

    it('derives the same key for the same user every time', async () => {
      const first = await custodialStore().getPlayerSigner('user-1');
      const second = await custodialStore().getPlayerSigner('user-1');

      expect(first!.publicKey()).toBe(second!.publicKey());
    });

    it('derives different keys for different users', async () => {
      const store = custodialStore();
      const a = await store.getPlayerSigner('user-1');
      const b = await store.getPlayerSigner('user-2');

      expect(a!.publicKey()).not.toBe(b!.publicKey());
    });

    it('derives different keys under a different master seed', async () => {
      const a = await custodialStore().getPlayerSigner('user-1');
      const b = await custodialStore({
        STELLAR_CUSTODIAL_MASTER_SEED: 'a-different-seed',
      }).getPlayerSigner('user-1');

      expect(a!.publicKey()).not.toBe(b!.publicKey());
    });

    it('agrees with getPlayerAddress on the derived account', async () => {
      const store = custodialStore();
      const signer = await store.getPlayerSigner('user-1');
      const address = await store.getPlayerAddress('user-1');

      expect(address).toBe(signer!.publicKey());
    });

    it('derives a key that can actually sign', async () => {
      const signer = await custodialStore().getPlayerSigner('user-1');
      const payload = Buffer.from('a-transaction-hash');

      expect(signer!.verify(payload, signer!.sign(payload))).toBe(true);
    });
  });

  describe('non-custodial player keys', () => {
    it('never returns a player signer', async () => {
      expect(await nonCustodialStore().getPlayerSigner('user-1')).toBeNull();
    });

    it('never returns a player address, even with a master seed set', async () => {
      const store = nonCustodialStore({
        STELLAR_CUSTODIAL_MASTER_SEED: masterSeed,
      });

      expect(await store.getPlayerAddress('user-1')).toBeNull();
    });
  });
});

describe('NonCustodialKeyStore', () => {
  it('is never custodial and never yields player keys', async () => {
    const store = new NonCustodialKeyStore(
      configOf({ STELLAR_RESOLVER_SECRET: Keypair.random().secret() }),
    );

    expect(store.custodial).toBe(false);
    expect(store.name).toBe('non-custodial');
    expect(await store.getPlayerSigner()).toBeNull();
    expect(await store.getPlayerAddress()).toBeNull();
  });

  it('returns the configured resolver keypair', () => {
    const secret = Keypair.random().secret();
    const store = new NonCustodialKeyStore(
      configOf({ STELLAR_RESOLVER_SECRET: secret }),
    );

    expect(store.getResolverKeypair().secret()).toBe(secret);
  });

  it('rejects a malformed resolver secret at construction', () => {
    expect(
      () =>
        new NonCustodialKeyStore(
          configOf({ STELLAR_RESOLVER_SECRET: 'not-a-seed' }),
        ),
    ).toThrow(/not a valid secret seed/);
  });

  it('constructs without a resolver key but throws when one is needed', () => {
    const store = new NonCustodialKeyStore(configOf({}));

    expect(() => store.getResolverKeypair()).toThrow(
      /No resolver key configured/,
    );
  });
});
