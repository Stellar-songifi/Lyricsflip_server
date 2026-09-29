import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

/**
 * Tracks in-flight settlement operations so the process can drain them
 * gracefully before it exits on SIGTERM.
 *
 * Usage in WagerService:
 *
 *   const done = this.tracker.register(sessionId);
 *   try {
 *     // ... network call ...
 *   } finally {
 *     done();
 *   }
 *
 * On SIGTERM NestJS calls onApplicationShutdown(), which waits up to
 * SETTLEMENT_DRAIN_TIMEOUT_MS for all in-flight settlements to complete,
 * then exits regardless.
 */
@Injectable()
export class InFlightSettlementTracker implements OnApplicationShutdown {
  private readonly logger = new Logger(InFlightSettlementTracker.name);

  /**
   * Each entry is a Promise that resolves when the settlement is done.
   * The key is a descriptive label (session ID) used only for logging.
   */
  private readonly pending = new Map<string, Promise<void>>();

  /**
   * How long (ms) to wait for in-flight settlements to finish on shutdown.
   * Configurable via SETTLEMENT_DRAIN_TIMEOUT_MS; defaults to 30 seconds.
   */
  private get drainTimeoutMs(): number {
    const raw = process.env['SETTLEMENT_DRAIN_TIMEOUT_MS'];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
  }

  /**
   * Registers a new in-flight settlement.
   *
   * @param label A descriptive label (e.g. session ID) used in log messages.
   * @returns A callback that must be called when the settlement is done.
   */
  register(label: string): () => void {
    let resolveFn!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    this.pending.set(label, promise);

    return () => {
      this.pending.delete(label);
      resolveFn();
    };
  }

  /** Number of currently in-flight settlements. */
  get count(): number {
    return this.pending.size;
  }

  /**
   * Called by NestJS when the application receives SIGTERM (or SIGINT).
   *
   * Waits up to drainTimeoutMs for all in-flight settlements to complete,
   * then logs a warning and continues the shutdown regardless so the process
   * does not hang indefinitely.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }

    this.logger.warn(
      `Shutdown signal ${signal ?? 'unknown'} received with ` +
        `${this.pending.size} in-flight settlement(s) — draining ` +
        `(timeout: ${this.drainTimeoutMs}ms)`,
    );

    const labels = [...this.pending.keys()];
    this.logger.debug(`In-flight sessions: ${labels.join(', ')}`);

    const drain = Promise.all([...this.pending.values()]);
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => resolve(), this.drainTimeoutMs),
    );

    await Promise.race([drain, timeout]);

    if (this.pending.size > 0) {
      this.logger.warn(
        `Drain timeout reached; ${this.pending.size} settlement(s) still in ` +
          `flight — proceeding with shutdown. Sessions: ` +
          `${[...this.pending.keys()].join(', ')}`,
      );
    } else {
      this.logger.log('All in-flight settlements completed before timeout.');
    }
  }
}
