import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard tracker', () => {
  const tracker = (req: any) =>
    (AppThrottlerGuard.prototype as any).getTracker.call({}, req);

  it('keys by user id when authenticated', async () => {
    expect(await tracker({ user: { id: 'u1' }, ip: '1.1.1.1' })).toBe(
      'user:u1',
    );
  });

  it('falls back to IP', async () => {
    expect(await tracker({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
  });
});
