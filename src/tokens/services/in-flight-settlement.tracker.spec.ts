import { Test, TestingModule } from '@nestjs/testing';
import { InFlightSettlementTracker } from './in-flight-settlement.tracker';

/**
 * Simulates a SIGTERM arriving while a settlement is in flight by calling
 * onApplicationShutdown() before the tracked operation resolves.
 */
describe('InFlightSettlementTracker', () => {
  let tracker: InFlightSettlementTracker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InFlightSettlementTracker],
    }).compile();

    tracker = module.get<InFlightSettlementTracker>(InFlightSettlementTracker);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with no in-flight operations', () => {
    expect(tracker.count).toBe(0);
  });

  it('tracks a registered operation and removes it when done is called', () => {
    const done = tracker.register('session-abc');
    expect(tracker.count).toBe(1);
    done();
    expect(tracker.count).toBe(0);
  });

  it('tracks multiple operations independently', () => {
    const done1 = tracker.register('session-1');
    const done2 = tracker.register('session-2');
    expect(tracker.count).toBe(2);
    done1();
    expect(tracker.count).toBe(1);
    done2();
    expect(tracker.count).toBe(0);
  });

  it('onApplicationShutdown resolves immediately when no operations are in flight', async () => {
    await expect(tracker.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined();
  });

  it('onApplicationShutdown waits for an in-flight settlement to complete', async () => {
    // Register an operation that resolves after a short delay.
    const done = tracker.register('session-settling');

    let shutdownResolved = false;
    const shutdownPromise = tracker
      .onApplicationShutdown('SIGTERM')
      .then(() => {
        shutdownResolved = true;
      });

    // Operation is still in flight — shutdown should not have resolved yet.
    await Promise.resolve(); // flush microtasks
    expect(shutdownResolved).toBe(false);

    // Complete the operation.
    done();
    await shutdownPromise;

    expect(shutdownResolved).toBe(true);
    expect(tracker.count).toBe(0);
  });

  it('onApplicationShutdown times out if a settlement does not finish', async () => {
    jest.useFakeTimers();

    // Override the drain timeout to 100 ms for the test.
    const originalEnv = process.env['SETTLEMENT_DRAIN_TIMEOUT_MS'];
    process.env['SETTLEMENT_DRAIN_TIMEOUT_MS'] = '100';

    // Register an operation that never resolves.
    tracker.register('session-hanging');
    expect(tracker.count).toBe(1);

    const shutdownPromise = tracker.onApplicationShutdown('SIGTERM');

    // Advance past the drain timeout.
    jest.advanceTimersByTime(200);

    await shutdownPromise;

    // The tracker should have timed out but the process did not hang.
    // The pending entry is still there (the operation never finished).
    expect(tracker.count).toBe(1);

    // Restore env.
    if (originalEnv === undefined) {
      delete process.env['SETTLEMENT_DRAIN_TIMEOUT_MS'];
    } else {
      process.env['SETTLEMENT_DRAIN_TIMEOUT_MS'] = originalEnv;
    }
  });

  it('removes the operation from the tracker even if it throws', async () => {
    const done = tracker.register('session-error');

    // Simulate the settlement throwing — caller must call done() in a finally.
    try {
      throw new Error('network error');
    } finally {
      done();
    }

    expect(tracker.count).toBe(0);
  });
});
