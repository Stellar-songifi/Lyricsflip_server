import { SessionExpiryService } from './session-expiry.service';
import { GameSessionStatus } from './entities/game-session.entity';

describe('SessionExpiryService', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const update = jest.fn();
  const config = { get: jest.fn() };
  const service = new SessionExpiryService({ update } as any, config as any);

  beforeEach(() => {
    jest.useFakeTimers({ now });
    jest.clearAllMocks();
    update.mockResolvedValue({ affected: 2 });
  });

  afterEach(() => jest.useRealTimers());

  it('abandons unwagered sessions idle for SESSION_TIMEOUT_MINUTES', async () => {
    config.get.mockReturnValue(10);

    await expect(service.sweep()).resolves.toBe(2);

    const [where, changes] = update.mock.calls[0];
    expect(changes).toEqual({ status: GameSessionStatus.ABANDONED });
    expect(where.hasWager).toBe(false);
    // Cutoff is exactly ten minutes before "now".
    expect(where.updatedAt.value.getTime()).toBe(now.getTime() - 10 * 60_000);
  });

  it('defaults to 30 minutes and leaves wagered sessions to the refund job', async () => {
    config.get.mockReturnValue(undefined);

    await service.sweep();

    const [where] = update.mock.calls[0];
    expect(where.updatedAt.value.getTime()).toBe(now.getTime() - 30 * 60_000);
    expect(where.hasWager).toBe(false);
  });
});
