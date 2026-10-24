import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

/**
 * Terminus health indicator that PINGs Redis. Only wired into the readiness
 * check when REDIS_URL is set. Uses its own lazily-created client so a down
 * Redis fails the probe quickly instead of queueing commands forever.
 */
@Injectable()
export class RedisHealthIndicator
  extends HealthIndicator
  implements OnModuleDestroy
{
  private client?: RedisClient;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private getClient(url: string): RedisClient {
    if (!this.client) {
      this.client = createClient({
        url,
        socket: { connectTimeout: 2000, reconnectStrategy: () => 1000 },
        disableOfflineQueue: true,
      });
      this.client.on('error', () => undefined);
    }
    return this.client;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      return this.getStatus(key, true);
    }

    try {
      const client = this.getClient(url);
      if (!client.isOpen) {
        await client.connect();
      }
      await client.ping();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'Redis unreachable',
        this.getStatus(key, false),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit().catch(() => undefined);
    }
  }
}
