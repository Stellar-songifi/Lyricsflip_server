import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { loadStellarConfig } from './stellar.config';

/** A ConfigService that reads from a plain object. */
const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const contractId = () => StrKey.encodeContract(Keypair.random().rawPublicKey());

describe('loadStellarConfig', () => {
  let resolverSecret: string;
  let stellarEnv: Record<string, string>;

  beforeEach(() => {
    // Silence the mode warnings the loader emits on every call.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    resolverSecret = Keypair.random().secret();
    stellarEnv = {
      STELLAR_SETTLEMENT_MODE: 'stellar',
      STELLAR_NETWORK: 'testnet',
      STELLAR_ESCROW_CONTRACT_ID: contractId(),
      STELLAR_TOKEN_CONTRACT_ID: contractId(),
      STELLAR_RESOLVER_SECRET: resolverSecret,
    };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('defaults', () => {
    it('runs in mock mode on testnet when nothing is configured', () => {
      const config = loadStellarConfig(configOf({}));

      expect(config.settlementMode).toBe('mock');
      expect(config.custodyMode).toBe('non-custodial');
      expect(config.network).toBe('testnet');
      expect(config.networkPassphrase).toBe(Networks.TESTNET);
      expect(config.isTestNetwork).toBe(true);
      expect(config.webAuthDomain).toBe('localhost');
    });

    it('does not require contract IDs in mock mode', () => {
      const config = loadStellarConfig(configOf({}));

      expect(config.escrowContractId).toBe('');
      expect(config.tokenContractId).toBe('');
    });

    it('picks RPC and Horizon endpoints to match the network', () => {
      const testnet = loadStellarConfig(
        configOf({ STELLAR_NETWORK: 'testnet' }),
      );
      expect(testnet.rpcUrl).toBe('https://soroban-testnet.stellar.org');
      expect(testnet.horizonUrl).toBe('https://horizon-testnet.stellar.org');

      const futurenet = loadStellarConfig(
        configOf({ STELLAR_NETWORK: 'futurenet' }),
      );
      expect(futurenet.rpcUrl).toBe('https://rpc-futurenet.stellar.org');
    });

    it('lets explicit endpoints override the per-network defaults', () => {
      const config = loadStellarConfig(
        configOf({
          STELLAR_RPC_URL: 'http://localhost:8000/soroban/rpc',
          STELLAR_HORIZON_URL: 'http://localhost:8000',
        }),
      );

      expect(config.rpcUrl).toBe('http://localhost:8000/soroban/rpc');
      expect(config.horizonUrl).toBe('http://localhost:8000');
    });

    it('marks only the public network as non-test', () => {
      expect(
        loadStellarConfig(configOf({ STELLAR_NETWORK: 'public' }))
          .isTestNetwork,
      ).toBe(false);
      expect(
        loadStellarConfig(configOf({ STELLAR_NETWORK: 'standalone' }))
          .isTestNetwork,
      ).toBe(true);
    });
  });

  describe('validation', () => {
    it('rejects an unknown settlement mode', () => {
      expect(() =>
        loadStellarConfig(configOf({ STELLAR_SETTLEMENT_MODE: 'chain' })),
      ).toThrow(/must be "mock" or "stellar"/);
    });

    it('rejects an unknown network', () => {
      expect(() =>
        loadStellarConfig(configOf({ STELLAR_NETWORK: 'mainnet' })),
      ).toThrow(/STELLAR_NETWORK must be one of/);
    });

    it('rejects an unknown custody mode', () => {
      expect(() =>
        loadStellarConfig(configOf({ STELLAR_CUSTODY_MODE: 'partial' })),
      ).toThrow(/must be "custodial" or "non-custodial"/);
    });

    it('accepts modes in any casing', () => {
      const config = loadStellarConfig(
        configOf({
          ...stellarEnv,
          STELLAR_SETTLEMENT_MODE: 'STELLAR',
          STELLAR_NETWORK: 'TestNet',
          STELLAR_CUSTODY_MODE: 'Non-Custodial',
        }),
      );

      expect(config.settlementMode).toBe('stellar');
      expect(config.network).toBe('testnet');
      expect(config.custodyMode).toBe('non-custodial');
    });

    it('rejects a resolver secret that is not a valid seed', () => {
      expect(() =>
        loadStellarConfig(configOf({ STELLAR_RESOLVER_SECRET: 'not-a-seed' })),
      ).toThrow(/not a valid Stellar secret seed/);
    });

    it('derives the resolver public key from its secret', () => {
      const config = loadStellarConfig(configOf(stellarEnv));

      expect(config.resolverPublicKey).toBe(
        Keypair.fromSecret(resolverSecret).publicKey(),
      );
    });

    it('never exposes the resolver secret on the config object', () => {
      const config = loadStellarConfig(configOf(stellarEnv));

      expect(JSON.stringify(config)).not.toContain(resolverSecret);
    });
  });

  describe('stellar mode requirements', () => {
    it('requires the escrow contract ID', () => {
      expect(() =>
        loadStellarConfig(
          configOf({ ...stellarEnv, STELLAR_ESCROW_CONTRACT_ID: undefined }),
        ),
      ).toThrow(/STELLAR_ESCROW_CONTRACT_ID is required/);
    });

    it('requires the token contract ID', () => {
      expect(() =>
        loadStellarConfig(
          configOf({ ...stellarEnv, STELLAR_TOKEN_CONTRACT_ID: undefined }),
        ),
      ).toThrow(/STELLAR_TOKEN_CONTRACT_ID is required/);
    });

    it('requires the resolver secret', () => {
      expect(() =>
        loadStellarConfig(
          configOf({ ...stellarEnv, STELLAR_RESOLVER_SECRET: undefined }),
        ),
      ).toThrow(/STELLAR_RESOLVER_SECRET is required/);
    });

    it('rejects a contract ID that is not a C-address', () => {
      expect(() =>
        loadStellarConfig(
          configOf({
            ...stellarEnv,
            STELLAR_ESCROW_CONTRACT_ID: Keypair.random().publicKey(),
          }),
        ),
      ).toThrow(/not a valid Stellar contract ID/);
    });

    it('boots with a complete configuration', () => {
      const config = loadStellarConfig(configOf(stellarEnv));

      expect(config.settlementMode).toBe('stellar');
      expect(StrKey.isValidContract(config.escrowContractId)).toBe(true);
    });
  });

  describe('custodial safety', () => {
    it('refuses to start custodial on the public network', () => {
      expect(() =>
        loadStellarConfig(
          configOf({
            ...stellarEnv,
            STELLAR_NETWORK: 'public',
            STELLAR_CUSTODY_MODE: 'custodial',
          }),
        ),
      ).toThrow(/Refusing to start: custodial mode on the public network/);
    });

    it('allows custodial mode on a test network', () => {
      const config = loadStellarConfig(
        configOf({ ...stellarEnv, STELLAR_CUSTODY_MODE: 'custodial' }),
      );

      expect(config.custodyMode).toBe('custodial');
    });

    it('allows non-custodial mode on the public network', () => {
      const config = loadStellarConfig(
        configOf({ ...stellarEnv, STELLAR_NETWORK: 'public' }),
      );

      expect(config.network).toBe('public');
      expect(config.networkPassphrase).toBe(Networks.PUBLIC);
    });

    it('warns when settling in mock mode', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      loadStellarConfig(configOf({}));

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('wagers settle in Postgres'),
      );
    });
  });

  it('honours an explicit passphrase for a custom standalone network', () => {
    const config = loadStellarConfig(
      configOf({
        STELLAR_NETWORK: 'standalone',
        STELLAR_NETWORK_PASSPHRASE: 'Custom Test Network ; 2026',
      }),
    );

    expect(config.networkPassphrase).toBe('Custom Test Network ; 2026');
  });
});
