import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { StellarRpcHealthIndicator } from './stellar-rpc.health';

/**
 * Exposes /health/live and /health/ready probe endpoints.
 * StellarRpcService is available globally via StellarModule (@Global).
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [StellarRpcHealthIndicator],
})
export class HealthModule {}
