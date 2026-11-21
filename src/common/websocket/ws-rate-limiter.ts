import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { wsRateLimit } from '../throttler/throttle.config';

interface TokenBucket {
  tokens: number;
  capacity: number;
  refillPerSec: number;
  lastRefill: number;
  violations: number;
}

interface ClientBuckets {
  buckets: Map<string, TokenBucket>;
  disconnectAfter: number;
}

/**
 * Per-socket, per-event token bucket rate limiter for WebSocket gateways.
 *
 * Limits are sourced from `wsRateLimit()` in `throttle.config.ts`. Each socket
 * gets an independent bucket per event name. When a client exceeds its limit
 * the event is rejected (consume() returns false) and a `RATE_LIMITED` error
 * is emitted. After `disconnectAfter` consecutive violations the socket is
 * disconnected.
 */
@Injectable()
export class WsRateLimiter {
  private readonly logger = new Logger(WsRateLimiter.name);
  private readonly clients = new Map<string, ClientBuckets>();

  /**
   * Attempt to consume a token for the given client and event.
   *
   * @returns `true` if the event is allowed, `false` if it was rate limited.
   */
  consume(client: Socket, event: string): boolean {
    const config = wsRateLimit();
    const clientId = this.clientId(client);

    let entry = this.clients.get(clientId);
    if (!entry) {
      entry = { buckets: new Map(), disconnectAfter: config.disconnectAfter };
      this.clients.set(clientId, entry);
    }
    entry.disconnectAfter = config.disconnectAfter;

    const now = Date.now();
    let bucket = entry.buckets.get(event);
    if (!bucket) {
      bucket = {
        tokens: config.capacity,
        capacity: config.capacity,
        refillPerSec: config.refillPerSec,
        lastRefill: now,
        violations: 0,
      };
      entry.buckets.set(event, bucket);
    }

    // Refill tokens based on elapsed time.
    const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + elapsedSec * bucket.refillPerSec,
      );
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.violations = 0;
      return true;
    }

    // Over the limit.
    bucket.violations += 1;
    this.reject(client, event, bucket.violations, entry.disconnectAfter);
    return false;
  }

  /**
   * Clear all rate-limit state for a client (e.g. on disconnect).
   */
  clear(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Clear all rate-limit state for every client.
   */
  clearAll(): void {
    this.clients.clear();
  }

  private reject(
    client: Socket,
    event: string,
    violations: number,
    disconnectAfter: number,
  ): void {
    try {
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded for event "${event}"`,
        event,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit RATE_LIMITED to client: ${(err as Error).message}`,
      );
    }

    if (disconnectAfter > 0 && violations >= disconnectAfter) {
      this.logger.warn(
        `Disconnecting client ${this.clientId(client)} after ${violations} rate-limit violations on "${event}"`,
      );
      try {
        client.disconnect(true);
      } catch (err) {
        this.logger.warn(
          `Failed to disconnect rate-limited client: ${(err as Error).message}`,
        );
      }
      this.clear(this.clientId(client));
    }
  }

  private clientId(client: Socket): string {
    return client.id;
  }
}