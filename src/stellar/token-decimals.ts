import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Reads the token contract's on-chain `decimals()` once at boot and exposes it
 * as the single source of truth for amount conversions.
 *
 * Boot fails when the on-chain value differs from the configured
 * `LYRIC_TOKEN_DECIMALS`, so `amount.util.ts` and the contract can never
 * disagree about how many decimals a LYRIC has.
 */
@Injectable()
export class TokenDecimalsService implements OnModuleInit {
  private readonly logger = new Logger(TokenDecimalsService.name);
  private decimals: number | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const contractId = this.config.get<string>('LYRIC_TOKEN_CONTRACT_ID');
    const configured = this.getConfiguredDecimals();

    if (!contractId) {
      this.logger.warn(
        'LYRIC_TOKEN_CONTRACT_ID is not set; skipping on-chain decimals check',
      );
      this.decimals = configured;
      return;
    }

    const onChain = await this.readOnChainDecimals(contractId);

    if (onChain !== configured) {
      throw new Error(
        `Token decimals mismatch: contract ${contractId} reports ${onChain} decimals but LYRIC_TOKEN_DECIMALS is ${configured}`,
      );
    }

    this.decimals = onChain;
    this.logger.log(`Token decimals verified: ${onChain}`);
  }

  /**
   * Returns the verified decimals. Falls back to the configured value when the
   * service has not completed its boot check (e.g. in unit tests).
   */
  getDecimals(): number {
    return this.decimals ?? this.getConfiguredDecimals();
  }

  private getConfiguredDecimals(): number {
    const raw = this.config.get<string>('LYRIC_TOKEN_DECIMALS');
    const parsed = raw === undefined ? 7 : Number(raw);

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(
        `Invalid LYRIC_TOKEN_DECIMALS value: ${raw}. Expected a non-negative integer.`,
      );
    }

    return parsed;
  }

  private async readOnChainDecimals(contractId: string): Promise<number> {
    const rpcUrl = this.config.get<string>('STELLAR_SOROBAN_RPC_URL');

    if (!rpcUrl) {
      throw new Error(
        'STELLAR_SOROBAN_RPC_URL is required to read token decimals at boot',
      );
    }

    const server = new rpc.Server(rpcUrl);
    const account = await server.getAccount(
      this.config.get<string>('STELLAR_BOOT_ACCOUNT') ?? contractId,
    );

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.config.get<string>(
        'STELLAR_NETWORK_PASSPHRASE',
      ),
    })
      .addOperation(contract.call('decimals'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(
        `Failed to read decimals() from ${contractId}: ${simulation.error}`,
      );
    }

    const retval = simulation.result?.retval as xdr.ScVal | undefined;

    if (!retval) {
      throw new Error(`decimals() on ${contractId} returned no value`);
    }

    const native = scValToNative(retval);
    const value = typeof native === 'bigint' ? Number(native) : Number(native);

    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `decimals() on ${contractId} returned an invalid value: ${String(native)}`,
      );
    }

    return value;
  }
}

/**
 * Reads configured decimals for synchronous amount conversions. A caller
 * that supplies config can verify the value against the contract at boot.
 */
export function getTokenDecimals(): number;
export function getTokenDecimals(config: ConfigService): Promise<number>;
export function getTokenDecimals(
  config?: ConfigService,
): number | Promise<number> {
  if (!config) {
    return new TokenDecimalsService(new ConfigService()).getDecimals();
  }
  const service = new TokenDecimalsService(config);
  return service.onModuleInit().then(() => service.getDecimals());
}
