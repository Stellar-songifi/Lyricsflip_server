import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Owns every Prometheus metric used across the application.
 *
 * A dedicated Registry (not the global default) is used so that tests that
 * import this service do not collide with each other through shared state.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // ------------------------------------------------------------------
  // HTTP metrics
  // ------------------------------------------------------------------

  /** Latency distribution for every HTTP request, by method / route / status. */
  readonly httpRequestDuration: Histogram<string>;

  /** Total HTTP request count, by method / route / status. */
  readonly httpRequestTotal: Counter<string>;

  // ------------------------------------------------------------------
  // Wager / settlement metrics
  // ------------------------------------------------------------------

  /** Current number of wagers in each WagerStatus. Refreshed every 30 s. */
  readonly wagersByStatus: Gauge<string>;

  /** Cumulative wager settlements by outcome (won | refunded | failed). */
  readonly settlementOutcomes: Counter<string>;

  // ------------------------------------------------------------------
  // Stellar RPC metrics
  // ------------------------------------------------------------------

  /** Latency distribution for Soroban RPC calls, by method and success flag. */
  readonly rpcCallDuration: Histogram<string>;

  /** Total Soroban RPC call errors, by method. */
  readonly rpcCallErrors: Counter<string>;

  constructor() {
    this.httpRequestDuration = new Histogram({
      name: 'lyricsflip_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestTotal = new Counter({
      name: 'lyricsflip_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.wagersByStatus = new Gauge({
      name: 'lyricsflip_wagers_by_status',
      help: 'Number of wagers in each status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.settlementOutcomes = new Counter({
      name: 'lyricsflip_settlement_outcomes_total',
      help: 'Total number of wager settlements by outcome',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    this.rpcCallDuration = new Histogram({
      name: 'lyricsflip_rpc_call_duration_seconds',
      help: 'Duration of Stellar RPC calls in seconds',
      labelNames: ['method', 'success'],
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });

    this.rpcCallErrors = new Counter({
      name: 'lyricsflip_rpc_call_errors_total',
      help: 'Total number of Stellar RPC call errors by method',
      labelNames: ['method'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Collect default Node.js / process metrics (heap, GC, event-loop lag…)
    collectDefaultMetrics({ register: this.registry });
  }

  /** Returns the full Prometheus text exposition. */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Content-Type header value expected by Prometheus scrapers. */
  getContentType(): string {
    return this.registry.contentType;
  }
}
