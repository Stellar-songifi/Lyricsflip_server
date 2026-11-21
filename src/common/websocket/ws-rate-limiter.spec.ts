import { WsRateLimiter } from './ws-rate-limiter';

describe('WsRateLimiter', () => {
  let limiter: WsRateLimiter;

  beforeEach(() => {
    limiter = new WsRateLimiter({
      defaultLimit: 3,
      defaultWindowMs: 1000,
      eventLimits: {
        'chat:send': { limit: 2, windowMs: 1000 },
      },
    });
  });

  afterEach(() => {
    limiter.reset();
  });

  it('allows requests up to the default limit', () => {
    const socketId = 'socket-1';
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
  });

  it('rejects requests once the token bucket is exhausted', () => {
    const socketId = 'socket-1';
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
    expect(limiter.consume(socketId, 'some:event')).toBe(true);
    expect(limiter.consume(socketId, 'some:event')).toBe(false);
  });

  it('uses per-event limits when configured', () => {
    const socketId = 'socket-1';
    expect(limiter.consume(socketId, 'chat:send')).toBe(true);
    expect(limiter.consume(socketId, 'chat:send')).toBe(true);
    expect(limiter.consume(socketId, 'chat:send')).toBe(false);
  });

  it('tracks limits independently per socket', () => {
    expect(limiter.consume('socket-1', 'some:event')).toBe(true);
    expect(limiter.consume('socket-1', 'some:event')).toBe(true);
    expect(limiter.consume('socket-1', 'some:event')).toBe(true);
    expect(limiter.consume('socket-1', 'some:event')).toBe(false);

    expect(limiter.consume('socket-2', 'some:event')).toBe(true);
  });

  it('tracks limits independently per event', () => {
    const socketId = 'socket-1';
    expect(limiter.consume(socketId, 'event:a')).toBe(true);
    expect(limiter.consume(socketId, 'event:a')).toBe(true);
    expect(limiter.consume(socketId, 'event:a')).toBe(true);
    expect(limiter.consume(socketId, 'event:a')).toBe(false);

    expect(limiter.consume(socketId, 'event:b')).toBe(true);
  });

  it('refills tokens after the window elapses', () => {
    jest.useFakeTimers();
    try {
      const socketId = 'socket-1';
      expect(limiter.consume(socketId, 'some:event')).toBe(true);
      expect(limiter.consume(socketId, 'some:event')).toBe(true);
      expect(limiter.consume(socketId, 'some:event')).toBe(true);
      expect(limiter.consume(socketId, 'some:event')).toBe(false);

      jest.advanceTimersByTime(1001);

      expect(limiter.consume(socketId, 'some:event')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports remaining tokens', () => {
    const socketId = 'socket-1';
    expect(limiter.remaining(socketId, 'some:event')).toBe(3);
    limiter.consume(socketId, 'some:event');
    expect(limiter.remaining(socketId, 'some:event')).toBe(2);
  });

  it('clears state for a socket on release', () => {
    const socketId = 'socket-1';
    limiter.consume(socketId, 'some:event');
    limiter.consume(socketId, 'some:event');
    limiter.consume(socketId, 'some:event');
    expect(limiter.consume(socketId, 'some:event')).toBe(false);

    limiter.release(socketId);

    expect(limiter.consume(socketId, 'some:event')).toBe(true);
  });

  it('resets all state', () => {
    limiter.consume('socket-1', 'some:event');
    limiter.consume('socket-1', 'some:event');
    limiter.consume('socket-1', 'some:event');
    expect(limiter.consume('socket-1', 'some:event')).toBe(false);

    limiter.reset();

    expect(limiter.consume('socket-1', 'some:event')).toBe(true);
  });
});