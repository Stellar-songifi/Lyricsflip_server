import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { StellarRpcService } from '../stellar/services/stellar-rpc.service';

/**
 * Terminus health indicator that pings the configured Soroban RPC endpoint.
 * Only wired into the readiness check when STELLAR_SETTLEMENT_MODE=stellar.
 */
@Injectable()
export class StellarRpcHealthIndicator extends HealthIndicator {
  constructor(private readonly rpc: StellarRpcService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    let healthy = false;
    let error: unknown;

    try {
      healthy = await this.rpc.isHealthy();
    } catch (err) {
      error = err;
      healthy = false;
    }

    const result = this.getStatus(key, healthy, {
      mode: 'stellar',
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });

    if (!healthy) {
      throw new HealthCheckError('Soroban RPC unreachable', result);
    }

    return result;
  }
}