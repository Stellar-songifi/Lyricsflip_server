import { runtimeEnv } from '../../config/runtime-env';
import { WagerReconcileJob } from './wager-reconcile.job';
import { WagerStatus } from '../entities/wager.entity';

describe('WagerReconcileJob', () => {
  const wager = { id: 'w1', sessionId: 's1' };
  let repo: { find: jest.Mock; update: jest.Mock };
  let wagers: { reconcileWager: jest.Mock };
  let job: WagerReconcileJob;

  beforeEach(() => {
    repo = { find: jest.fn().mockResolvedValue([wager]), update: jest.fn() };
    wagers = { reconcileWager: jest.fn() };
    job = new WagerReconcileJob(repo as any, wagers as any, {} as any);
  });

  it('reconciles settling wagers', async () => {
    wagers.reconcileWager.mockResolvedValue({ success: true, message: 'ok' });
    await job.reconcileStuckWagers();
    expect(wagers.reconcileWager).toHaveBeenCalledWith('s1');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('backs off after a failed attempt', async () => {
    wagers.reconcileWager.mockResolvedValue({ success: false });
    await job.reconcileStuckWagers();
    await job.reconcileStuckWagers();
    expect(wagers.reconcileWager).toHaveBeenCalledTimes(1);
  });

  it('marks FAILED after max attempts', async () => {
    runtimeEnv().WAGER_RECONCILE_MAX_ATTEMPTS = '1';
    wagers.reconcileWager.mockResolvedValue({ success: false });
    await job.reconcileStuckWagers();
    delete runtimeEnv().WAGER_RECONCILE_MAX_ATTEMPTS;
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'w1', status: WagerStatus.SETTLING },
      expect.objectContaining({ status: WagerStatus.FAILED }),
    );
  });

  it('skips the sweep when the advisory lock is held elsewhere', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ locked: false }]),
    };
    job = new WagerReconcileJob(
      repo as any,
      wagers as any,
      { createQueryRunner: () => runner } as any,
    );
    await job.sweep();
    expect(repo.find).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('propagates root span context linked to the wager during reconciliation', async () => {
    const api = require('@opentelemetry/api');
    const mockSpan = {
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    };
    const startActiveSpanSpy = jest.fn((name, options, fn) => fn(mockSpan));
    const tracerSpy = jest.spyOn(api.trace, 'getTracer').mockReturnValue({
      startActiveSpan: startActiveSpanSpy,
    } as any);
    const withContextSpy = jest
      .spyOn(api.context, 'with')
      .mockImplementation((_ctx, fn: any) => fn());

    wagers.reconcileWager.mockResolvedValue({ success: true, message: 'ok' });
    await job.reconcileStuckWagers();

    expect(startActiveSpanSpy).toHaveBeenCalledWith(
      'job.wager_reconcile.run',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'wager.id': 'w1',
          'session.id': 's1',
        }),
      }),
      expect.any(Function),
    );
    expect(mockSpan.end).toHaveBeenCalled();

    tracerSpy.mockRestore();
    withContextSpy.mockRestore();
  });
});
