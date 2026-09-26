import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { Wager } from './entities/wager.entity';
import { User } from '../users/entities/user.entity';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { MockTokenService } from './services/mock-token.service';
import { StellarTokenService } from './services/stellar-token.service';
import { WagerService } from './services/wager.service';
import { WagerRefundJob } from './services/wager-refund.job';
import { WagerReconcileJob } from './services/wager-reconcile.job';
import { TOKEN_SERVICE } from './interfaces/token.interface';
import { StellarModule } from '../stellar/stellar.module';
import { EscrowContractService } from '../stellar/services/escrow-contract.service';
import { StellarRpcService } from '../stellar/services/stellar-rpc.service';
import { IKeyStore } from '../stellar/interfaces/key-store.interface';
import { KEY_STORE, STELLAR_CONFIG } from '../stellar/stellar.constants';
import type { StellarConfig } from '../stellar/stellar.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wager, User, GameSession]),
    StellarModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    MockTokenService,
    StellarTokenService,
    {
      // Which settlement backend the game runs on is a deployment decision, not
      // a code one: the same wager flow drives Postgres rows in development and
      // the Soroban escrow contract in production.
      provide: TOKEN_SERVICE,
      inject: [
        STELLAR_CONFIG,
        getRepositoryToken(User),
        KEY_STORE,
        EscrowContractService,
        StellarRpcService,
      ],
      useFactory: (
        config: StellarConfig,
        userRepository: Repository<User>,
        keyStore: IKeyStore,
        escrow: EscrowContractService,
        rpc: StellarRpcService,
      ) => {
        const logger = new Logger('TokensModule');

        if (config.settlementMode === 'stellar') {
          logger.log(
            `Settling wagers through the escrow contract ${config.escrowContractId} on ${config.network}`,
          );
          return new StellarTokenService(
            userRepository,
            config,
            keyStore,
            escrow,
            rpc,
          );
        }

        logger.log('Settling wagers in Postgres (mock mode)');
        return new MockTokenService(userRepository);
      },
    },
    WagerService,
    WagerRefundJob,
    WagerReconcileJob,
  ],
  exports: [TOKEN_SERVICE, WagerService],
})
export class TokensModule {}
