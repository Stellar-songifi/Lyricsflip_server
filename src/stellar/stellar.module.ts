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
import { KmsKeyStore } from './services/kms-key-store.service';
import { AwsKmsSigner, VaultTransitSigner } from './services/aws-kms-signer';
import type { IKeyStore } from './interfaces/key-store.interface';
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
      // STELLAR_KEY_STORE picks the IKeyStore backend: "env" keeps today's
      // behaviour (custodial deployments derive player keys; non-custodial
      // ones cannot sign for players at all). "kms"/"vault" delegate resolver
      // signing to a remote signer so the resolver secret never sits in this
      // process's environment - see KmsKeyStore for setup and rotation notes.
      provide: KEY_STORE,
      inject: [ConfigService, STELLAR_CONFIG],
      useFactory: async (
        configService: ConfigService,
        config: StellarConfig,
      ): Promise<IKeyStore> => {
        const keyStore = (
          configService.get<string>('STELLAR_KEY_STORE') ?? 'env'
        ).toLowerCase();

        if (keyStore === 'kms') {
          const keyId = configService.get<string>('STELLAR_KMS_KEY_ID');
          const region = configService.get<string>('STELLAR_KMS_REGION');

          if (!keyId || !region) {
            throw new Error(
              'STELLAR_KMS_KEY_ID and STELLAR_KMS_REGION are required when ' +
                'STELLAR_KEY_STORE=kms',
            );
          }

          const store = new KmsKeyStore(
            new AwsKmsSigner(keyId, region),
            configService,
          );
          await store.init();
          return store;
        }

        if (keyStore === 'vault') {
          const addr = configService.get<string>('STELLAR_VAULT_ADDR');
          const token = configService.get<string>('STELLAR_VAULT_TOKEN');
          const key = configService.get<string>('STELLAR_VAULT_TRANSIT_KEY');

          if (!addr || !token || !key) {
            throw new Error(
              'STELLAR_VAULT_ADDR, STELLAR_VAULT_TOKEN and ' +
                'STELLAR_VAULT_TRANSIT_KEY are required when ' +
                'STELLAR_KEY_STORE=vault',
            );
          }

          const store = new KmsKeyStore(
            new VaultTransitSigner(addr, token, key),
            configService,
          );
          await store.init();
          return store;
        }

        return config.custodyMode === 'custodial'
          ? new EnvKeyStore(configService, config)
          : new NonCustodialKeyStore(configService);
      },
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
