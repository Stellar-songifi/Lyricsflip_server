import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { StellarRpcHealthIndicator } from './stellar-rpc.health';

/**
 * Kubernetes / load-balancer probe endpoints.
 *
 * GET /health/live  — liveness: is the process up and responding?
 * GET /health/ready — readiness: can it serve traffic?
 *                     Checks DB connectivity, optionally the Soroban RPC
 *                     (in stellar mode), and heap memory usage.
 *
 * Both endpoints are @Public() so they require no auth token.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly stellarRpc: StellarRpcHealthIndicator,
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
    // Only verify heap is not exhausted; no DB or RPC calls.
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
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
    summary: 'Readiness probe — database (and RPC in stellar mode) reachable',
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
    ];

    return this.health.check(checks);
  }
}
