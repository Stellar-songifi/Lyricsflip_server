import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { loadStellarConfig } from './stellar.config';
import { KEY_STORE, STELLAR_CONFIG } from './stellar.constants';
import { StellarRpcService } from './services/stellar-rpc.service';
import { EscrowContractService } from './services/escrow-contract.service';
import {
  EnvKeyStore,
  NonCustodialKeyStore,
} from './services/env-key-store.service';
import type { StellarConfig } from './stellar.config';
import { StellarController } from './stellar.controller';

/**
 * Everything that knows about Stellar.
 *
 * Global because the settlement configuration and RPC client are wanted by the
 * tokens module, the auth module's SEP-10 flow and the health endpoint alike,
 * and threading the same three providers through each of them adds nothing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [StellarController],
  providers: [
    {
      provide: STELLAR_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        loadStellarConfig(configService),
    },
    {
      // Custodial deployments derive player keys; non-custodial ones cannot
      // sign for players at all. Choosing here means no downstream service has
      // to ask which mode it is running in.
      provide: KEY_STORE,
      inject: [ConfigService, STELLAR_CONFIG],
      useFactory: (configService: ConfigService, config: StellarConfig) =>
        config.custodyMode === 'custodial'
          ? new EnvKeyStore(configService, config)
          : new NonCustodialKeyStore(configService),
    },
    StellarRpcService,
    EscrowContractService,
  ],
  exports: [
    STELLAR_CONFIG,
    KEY_STORE,
    StellarRpcService,
    EscrowContractService,
  ],
})
export class StellarModule {}
