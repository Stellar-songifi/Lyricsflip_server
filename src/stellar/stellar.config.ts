import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';

/**
 * How the backend settles wagers.
 *
 * - `mock`     — no network calls; balances live in Postgres. Used by tests and
 *                by contributors who do not want to run against a network.
 * - `stellar`  — stakes and payouts are real Soroban contract invocations.
 */
export type SettlementMode = 'mock' | 'stellar';

/**
 * Who signs a player's stake transaction.
 *
 * - `custodial`     — the backend holds the player's key and signs for them.
 *                     Convenient for testnet demos; **never** for mainnet with
 *                     real value, because the backend can move player funds.
 * - `non-custodial` — the backend builds an unsigned transaction and hands the
 *                     XDR to the client, which signs it with Freighter, xBull,
 *                     Albedo or any other wallet and sends it back.
 */
export type CustodyMode = 'custodial' | 'non-custodial';

export interface StellarConfig {
  /** Which settlement backend the TOKEN_SERVICE provider resolves to. */
  readonly settlementMode: SettlementMode;
  /** Who signs player stakes. */
  readonly custodyMode: CustodyMode;
  /** Network passphrase; also decides which network keys are valid on. */
  readonly networkPassphrase: string;
  /** Human-readable network name, for logs and the health endpoint. */
  readonly network: 'public' | 'testnet' | 'futurenet' | 'standalone';
  /** Soroban JSON-RPC endpoint. */
  readonly rpcUrl: string;
  /** Horizon endpoint, used for classic-account lookups and SEP-10. */
  readonly horizonUrl: string;
  /** Contract ID (C...) of the deployed LyricsFlip escrow contract. */
  readonly escrowContractId: string;
  /**
   * Contract ID (C...) of the LYRIC token — either a Soroban token contract or
   * the Stellar Asset Contract for a classic asset.
   */
  readonly tokenContractId: string;
  /**
   * Public key of the account that resolves wagers. The escrow contract only
   * accepts `resolve`/`refund` from this address.
   */
  readonly resolverPublicKey: string;
  /** Home domain advertised in SEP-10 challenges. */
  readonly webAuthDomain: string;
  /** Whether the network is a test network (enables friendbot funding). */
  readonly isTestNetwork: boolean;
}

const NETWORK_PASSPHRASES: Record<string, string> = {
  public: Networks.PUBLIC,
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  standalone: Networks.STANDALONE,
};

const DEFAULT_RPC_URLS: Record<string, string> = {
  public: 'https://mainnet.sorobanrpc.com',
  testnet: 'https://soroban-testnet.stellar.org',
  futurenet: 'https://rpc-futurenet.stellar.org',
  standalone: 'http://localhost:8000/soroban/rpc',
};

const DEFAULT_HORIZON_URLS: Record<string, string> = {
  public: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
  standalone: 'http://localhost:8000',
};

/**
 * Reads and validates the Stellar-related environment variables.
 *
 * Validation is strict on purpose: a typo in a contract ID or a key belonging
 * to the wrong network produces transactions that fail on-chain after funds
 * have already moved, which is far more expensive to debug than a failed boot.
 */
export function loadStellarConfig(configService: ConfigService): StellarConfig {
  const logger = new Logger('StellarConfig');

  // Validated as a plain string before being narrowed: casting an unchecked
  // environment value to the union first would make the guard below look
  // impossible to the type checker, even though it is the whole point.
  const rawSettlementMode = (
    configService.get<string>('STELLAR_SETTLEMENT_MODE') ?? 'mock'
  ).toLowerCase();

  if (rawSettlementMode !== 'mock' && rawSettlementMode !== 'stellar') {
    throw new Error(
      `STELLAR_SETTLEMENT_MODE must be "mock" or "stellar", got "${rawSettlementMode}"`,
    );
  }

  const settlementMode: SettlementMode = rawSettlementMode;

  const network = (
    configService.get<string>('STELLAR_NETWORK') ?? 'testnet'
  ).toLowerCase();

  if (!NETWORK_PASSPHRASES[network]) {
    throw new Error(
      `STELLAR_NETWORK must be one of ${Object.keys(NETWORK_PASSPHRASES).join(', ')}, got "${network}"`,
    );
  }

  const rawCustodyMode = (
    configService.get<string>('STELLAR_CUSTODY_MODE') ?? 'non-custodial'
  ).toLowerCase();

  if (rawCustodyMode !== 'custodial' && rawCustodyMode !== 'non-custodial') {
    throw new Error(
      `STELLAR_CUSTODY_MODE must be "custodial" or "non-custodial", got "${rawCustodyMode}"`,
    );
  }

  const custodyMode: CustodyMode = rawCustodyMode;

  const networkPassphrase =
    configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ??
    NETWORK_PASSPHRASES[network];

  const config: StellarConfig = {
    settlementMode,
    custodyMode,
    network: network as StellarConfig['network'],
    networkPassphrase,
    rpcUrl:
      configService.get<string>('STELLAR_RPC_URL') ?? DEFAULT_RPC_URLS[network],
    horizonUrl:
      configService.get<string>('STELLAR_HORIZON_URL') ??
      DEFAULT_HORIZON_URLS[network],
    escrowContractId:
      configService.get<string>('STELLAR_ESCROW_CONTRACT_ID') ?? '',
    tokenContractId:
      configService.get<string>('STELLAR_TOKEN_CONTRACT_ID') ?? '',
    resolverPublicKey: resolveResolverPublicKey(configService),
    webAuthDomain:
      configService.get<string>('STELLAR_WEB_AUTH_DOMAIN') ?? 'localhost',
    isTestNetwork: network !== 'public',
  };

  if (config.settlementMode === 'stellar') {
    assertContractId(config.escrowContractId, 'STELLAR_ESCROW_CONTRACT_ID');
    assertContractId(config.tokenContractId, 'STELLAR_TOKEN_CONTRACT_ID');

    if (!config.resolverPublicKey) {
      throw new Error(
        'STELLAR_RESOLVER_SECRET is required when STELLAR_SETTLEMENT_MODE=stellar',
      );
    }

    if (network === 'public' && custodyMode === 'custodial') {
      throw new Error(
        'Refusing to start: custodial mode on the public network would let the ' +
          'backend spend player funds. Set STELLAR_CUSTODY_MODE=non-custodial.',
      );
    }
  } else {
    logger.warn(
      'STELLAR_SETTLEMENT_MODE=mock — wagers settle in Postgres, not on Stellar. ' +
        'Set STELLAR_SETTLEMENT_MODE=stellar to use the escrow contract.',
    );
  }

  if (custodyMode === 'custodial') {
    logger.warn(
      'STELLAR_CUSTODY_MODE=custodial — the backend signs stakes on behalf of ' +
        'players. Acceptable on test networks only.',
    );
  }

  return config;
}

function resolveResolverPublicKey(configService: ConfigService): string {
  const secret = configService.get<string>('STELLAR_RESOLVER_SECRET');

  if (!secret) {
    return '';
  }

  if (!StrKey.isValidEd25519SecretSeed(secret)) {
    throw new Error(
      'STELLAR_RESOLVER_SECRET is not a valid Stellar secret seed (S...)',
    );
  }

  return Keypair.fromSecret(secret).publicKey();
}

function assertContractId(value: string, name: string): void {
  if (!value) {
    throw new Error(`${name} is required when STELLAR_SETTLEMENT_MODE=stellar`);
  }

  if (!StrKey.isValidContract(value)) {
    throw new Error(`${name} is not a valid Stellar contract ID (C...)`);
  }
}
