import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

export const DEFAULT_WS_MAX_SOCKETS_PER_USER = 5;
export const DEFAULT_WS_MAX_HTTP_BUFFER_SIZE = 16 * 1024;

/**
 * Resolve the maximum number of concurrent WebSocket sockets allowed per user.
 *
 * Configured through `WS_MAX_SOCKETS_PER_USER` (default 5).
 */
export function wsMaxSocketsPerUser(config?: ConfigService): number {
  const raw =
    config?.get<string | number>('WS_MAX_SOCKETS_PER_USER') ??
    process.env.WS_MAX_SOCKETS_PER_USER;

  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_MAX_SOCKETS_PER_USER;
  }

  return Math.floor(parsed);
}

/**
 * Resolve the maximum HTTP buffer size (in bytes) for WebSocket messages.
 *
 * Configured through `WS_MAX_HTTP_BUFFER_SIZE` (default 16 KB).
 */
export function wsMaxHttpBufferSize(config?: ConfigService): number {
  const raw =
    config?.get<string | number>('WS_MAX_HTTP_BUFFER_SIZE') ??
    process.env.WS_MAX_HTTP_BUFFER_SIZE;

  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_MAX_HTTP_BUFFER_SIZE;
  }

  return Math.floor(parsed);
}

/**
 * Maximum HTTP buffer size for WebSocket messages, configurable through the
 * environment (`WS_MAX_HTTP_BUFFER_SIZE`, default 16 KB).
 */
export const WS_MAX_HTTP_BUFFER_SIZE = wsMaxHttpBufferSize();

export interface WsConnectionLimiterOptions {
  /** Maximum concurrent sockets per user. Defaults to `wsMaxSocketsPerUser()`. */
  maxSocketsPerUser?: number;
  /** Optional Redis client used to count sockets across instances. */
  redis?: Redis | null;
  /** Key prefix for Redis counters. */
  keyPrefix?: string;
  /** TTL (seconds) applied to Redis counters as a safety net. */
  redisTtlSeconds?: number;
}

export interface WsConnectionAcquireResult {
  /** Whether the socket was admitted. */
  allowed: boolean;
  /** Number of sockets currently held by the user (after the attempt). */
  count: number;
  /** Configured maximum. */
  limit: number;
}

/**
 * Caps the number of concurrent WebSocket sockets per user.
 *
 * When a Redis client is configured, counters are kept in Redis so the limit
 * is enforced across instances. Otherwise an in-memory map is used.
 */
@Injectable()
export class WsConnectionLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(WsConnectionLimiter.name);
  private readonly maxSocketsPerUser: number;
  private readonly redis: Redis | null;
  private readonly keyPrefix: string;
  private readonly redisTtlSeconds: number;

  /** userId -> set of socketIds (in-memory fallback). */
  private readonly socketsByUser = new Map<string, Set<string>>();

  constructor(
    private readonly config?: ConfigService,
    options: WsConnectionLimiterOptions = {},
  ) {
    this.maxSocketsPerUser =
      options.maxSocketsPerUser ?? wsMaxSocketsPerUser(config);
    this.redis = options.redis ?? null;
    this.keyPrefix = options.keyPrefix ?? 'ws:conn';
    this.redisTtlSeconds = options.redisTtlSeconds ?? 60 * 60;
  }

  /** Configured maximum number of concurrent sockets per user. */
  get limit(): number {
    return this.maxSocketsPerUser;
  }

  /**
   * Attempt to register a socket for a user.
   *
   * Returns `allowed: false` when the user already holds the maximum number of
   * concurrent sockets. The socket is only tracked when admitted.
   */
  async acquire(
    userId: string,
    socketId: string,
  ): Promise<WsConnectionAcquireResult> {
    if (!userId) {
      return { allowed: false, count: 0, limit: this.maxSocketsPerUser };
    }

    if (this.redis) {
      return this.acquireRedis(userId, socketId);
    }

    return this.acquireMemory(userId, socketId);
  }

  /**
   * Release a socket previously registered for a user.
   *
   * Safe to call for sockets that were never admitted.
   */
  async release(userId: string, socketId: string): Promise<void> {
    if (!userId) {
      return;
    }

    if (this.redis) {
      await this.releaseRedis(userId, socketId);
      return;
    }

    this.releaseMemory(userId, socketId);
  }

  /** Current number of tracked sockets for a user. */
  async count(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }

    if (this.redis) {
      try {
        return await this.redis.scard(this.redisKey(userId));
      } catch (err) {
        this.logger.warn(
          `Failed to read Redis socket count for user ${userId}: ${(err as Error).message}`,
        );
        return this.memoryCount(userId);
      }
    }

    return this.memoryCount(userId);
  }

  async onModuleDestroy(): Promise<void> {
    this.socketsByUser.clear();
  }

  private acquireMemory(
    userId: string,
    socketId: string,
  ): WsConnectionAcquireResult {
    let sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      sockets = new Set<string>();
      this.socketsByUser.set(userId, sockets);
    }

    if (sockets.has(socketId)) {
      return {
        allowed: true,
        count: sockets.size,
        limit: this.maxSocketsPerUser,
      };
    }

    if (sockets.size >= this.maxSocketsPerUser) {
      return {
        allowed: false,
        count: sockets.size,
        limit: this.maxSocketsPerUser,
      };
    }

    sockets.add(socketId);

    return {
      allowed: true,
      count: sockets.size,
      limit: this.maxSocketsPerUser,
    };
  }

  private releaseMemory(userId: string, socketId: string): void {
    const sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      return;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  private memoryCount(userId: string): number {
    return this.socketsByUser.get(userId)?.size ?? 0;
  }

  private async acquireRedis(
    userId: string,
    socketId: string,
  ): Promise<WsConnectionAcquireResult> {
    const key = this.redisKey(userId);

    try {
      const added = await this.redis!.sadd(key, socketId);

      if (added === 0) {
        // Socket already tracked.
        const count = await this.redis!.scard(key);
        return {
          allowed: true,
          count,
          limit: this.maxSocketsPerUser,
        };
      }

      const count = await this.redis!.scard(key);

      if (count > this.maxSocketsPerUser) {
        await this.redis!.srem(key, socketId);
        const remaining = await this.redis!.scard(key);
        return {
          allowed: false,
          count: remaining,
          limit: this.maxSocketsPerUser,
        };
      }

      await this.redis!.expire(key, this.redisTtlSeconds);

      return {
        allowed: true,
        count,
        limit: this.maxSocketsPerUser,
      };
    } catch (err) {
      this.logger.warn(
        `Redis connection limiter failed for user ${userId}, falling back to memory: ${(err as Error).message}`,
      );
      return this.acquireMemory(userId, socketId);
    }
  }

  private async releaseRedis(userId: string, socketId: string): Promise<void> {
    const key = this.redisKey(userId);

    try {
      await this.redis!.srem(key, socketId);
      const remaining = await this.redis!.scard(key);

      if (remaining === 0) {
        await this.redis!.del(key);
      }
    } catch (err) {
      this.logger.warn(
        `Redis connection limiter release failed for user ${userId}: ${(err as Error).message}`,
      );
      this.releaseMemory(userId, socketId);
    }
  }

  private redisKey(userId: string): string {
    return `${this.keyPrefix}:${userId}`;
  }
}