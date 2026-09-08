import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { STELLAR_CONFIG, TOKEN_DECIMALS } from './stellar.constants';
import type { StellarConfig } from './stellar.config';
import { StellarRpcService } from './services/stellar-rpc.service';

/**
 * Network metadata clients need in order to talk to the same chain the backend
 * is on, plus a health probe for the RPC dependency.
 */
@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    @Inject(STELLAR_CONFIG) private readonly config: StellarConfig,
    private readonly rpc: StellarRpcService,
  ) {}

  @Public()
  @Get('info')
  @ApiOperation({
    summary:
      'Stellar network and contract details this backend is configured for',
  })
  @ApiResponse({ status: 200, description: 'Network configuration.' })
  getInfo() {
    return {
      settlementMode: this.config.settlementMode,
      custodyMode: this.config.custodyMode,
      network: this.config.network,
      networkPassphrase: this.config.networkPassphrase,
      rpcUrl: this.config.rpcUrl,
      horizonUrl: this.config.horizonUrl,
      escrowContractId: this.config.escrowContractId || null,
      tokenContractId: this.config.tokenContractId || null,
      // The resolver address is public by design: players can verify that the
      // account authorised to release their pot is the one they expect.
      resolverPublicKey: this.config.resolverPublicKey || null,
      tokenDecimals: TOKEN_DECIMALS,
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Whether the configured Soroban RPC endpoint is reachable',
  })
  @ApiResponse({ status: 200, description: 'RPC health.' })
  async getHealth() {
    if (this.config.settlementMode === 'mock') {
      return {
        settlementMode: 'mock',
        rpcHealthy: null,
        message: 'Mock settlement; no RPC in use',
      };
    }

    const healthy = await this.rpc.isHealthy();

    return {
      settlementMode: this.config.settlementMode,
      network: this.config.network,
      rpcHealthy: healthy,
      message: healthy ? 'Soroban RPC reachable' : 'Soroban RPC unreachable',
    };
  }
}
