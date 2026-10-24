import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { StellarRpcHealthIndicator } from './stellar-rpc.health';
import { RedisHealthIndicator } from './redis.health';

/**
 * Kubernetes / load-balancer probe endpoints.
 *
 * GET /health/live  — liveness: is the process up and responding?
 * GET /health/ready — readiness: can it serve traffic?
 *                     Checks DB connectivity, Redis (when REDIS_URL is set)
 *                     and, in stellar mode, the Soroban RPC.
 *
 * Both endpoints are @Public() so they require no auth token.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly stellarRpc: StellarRpcHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  /**
   * Liveness probe.
   * Returns 200 when the Node process is up and the event loop responds.
   * No external dependency checks — probes that fail here trigger a pod restart.
   */
  @Public()
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe — process is up' })
  @ApiResponse({ status: 200, description: 'Process is alive.' })
  @ApiResponse({ status: 503, description: 'Process unhealthy.' })
  live() {
    // Plain 200: reaching this handler proves the event loop is alive. Memory
    // pressure is left to the container's memory limit.
    return this.health.check([]);
  }

  /**
   * Readiness probe.
   * Returns 200 only when all critical dependencies are reachable.
   * A non-200 removes the pod from the load-balancer rotation without restarting it.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary:
      'Readiness probe — database, Redis (if configured) and RPC (stellar mode) reachable',
  })
  @ApiResponse({ status: 200, description: 'All dependencies healthy.' })
  @ApiResponse({ status: 503, description: 'One or more dependencies down.' })
  ready() {
    const stellarMode = this.config.get<string>(
      'STELLAR_SETTLEMENT_MODE',
      'mock',
    );

    const checks = [
      () => this.db.pingCheck('database'),
      ...(stellarMode === 'stellar'
        ? [() => this.stellarRpc.isHealthy('stellar_rpc')]
        : []),
      ...(this.config.get<string>('REDIS_URL')
        ? [() => this.redis.isHealthy('redis')]
        : []),
    ];

    return this.health.check(checks);
  }
}
