import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Single, shared implementation for making scheduled jobs run exclusively
 * across all application instances.
 *
 * The lock is a Postgres session-level advisory lock. Advisory locks are
 * owned by the session (connection) that acquired them, so the lock must be
 * acquired and released on the *same* dedicated query runner. Using the
 * pooled `DataSource.query` for acquire/release would (usually) hit different
 * connections and leak the lock until the pooled connection is closed.
 *
 * Every job run is also instrumented for observability: last success
 * timestamp, duration, failures and lock-skips are recorded as metrics.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Derive a stable 63-bit signed bigint key from a job name.
   *
   * Postgres advisory locks take a `bigint` key. We hash the name with
   * sha256, take the first 8 bytes and mask them into the signed 64-bit
   * range so the value is always a valid bigint literal.
   */
  static deriveKey(name: string): string {
    const digest = createHash('sha256').update(name, 'utf8').digest();
    // Read the first 8 bytes as an unsigned 64-bit big-endian integer.
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value = (value << 8n) | BigInt(digest[i]);
    }
    // Mask to the signed 64-bit range (63 usable bits + sign).
    const SIGNED_64_MASK = (1n << 63n) - 1n;
    value &= SIGNED_64_MASK;
    return value.toString();
  }

  /**
   * Run `fn` while holding an exclusive advisory lock for `name`.
   *
   * If the lock cannot be acquired (another instance is already running the
   * job), `fn` is not invoked and `undefined` is returned. Otherwise the
   * result of `fn` is returned. The lock is always released in a `finally`
   * block, and the dedicated query runner is always released afterwards.
   */
  async runExclusive<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const key = JobLockService.deriveKey(name);
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();

    let acquired = false;
    try {
      await queryRunner.connect();

      const rows: Array<{ locked: boolean }> = await queryRunner.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [key],
      );
      acquired = rows?.[0]?.locked === true;

      if (!acquired) {
        this.logger.debug(`Job "${name}" is already running elsewhere; skipping`);
        this.metrics.recordJobSkippedLocked(name);
        return undefined;
      }

      const start = process.hrtime.bigint();
      try {
        const result = await fn();
        this.metrics.recordJobSuccess(name, this.elapsedSeconds(start));
        return result;
      } catch (err) {
        this.metrics.recordJobFailure(name, this.elapsedSeconds(start));
        throw err;
      }
    } finally {
      if (acquired) {
        try {
          await queryRunner.query('SELECT pg_advisory_unlock($1::bigint)', [
            key,
          ]);
        } catch (err) {
          this.logger.error(
            `Failed to release advisory lock for job "${name}": ${
              (err as Error)?.message ?? err
            }`,
          );
        }
      }
      try {
        await queryRunner.release();
      } catch (err) {
        this.logger.error(
          `Failed to release query runner for job "${name}": ${
            (err as Error)?.message ?? err
          }`,
        );
      }
    }
  }

  private elapsedSeconds(start: bigint): number {
    return Number(process.hrtime.bigint() - start) / 1e9;
  }
}
