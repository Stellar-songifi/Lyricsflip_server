const num = (key: string, fallback: number): number => {
  const value = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Global default: THROTTLE_TTL_MS window, THROTTLE_LIMIT requests. */
export const defaultThrottle = () => ({
  ttl: num('THROTTLE_TTL_MS', 60_000),
  limit: num('THROTTLE_LIMIT', 100),
});

/** Stricter limit for login/signup: THROTTLE_AUTH_LIMIT per THROTTLE_AUTH_TTL_MS. */
export const authThrottle = {
  default: {
    ttl: num('THROTTLE_AUTH_TTL_MS', 60_000),
    limit: num('THROTTLE_AUTH_LIMIT', 5),
  },
};

/** SEP-10 endpoints: THROTTLE_STELLAR_LIMIT per THROTTLE_STELLAR_TTL_MS. */
export const stellarThrottle = {
  default: {
    ttl: num('THROTTLE_STELLAR_TTL_MS', 60_000),
    limit: num('THROTTLE_STELLAR_LIMIT', 10),
  },
};

/**
 * Data export: THROTTLE_EXPORT_LIMIT per THROTTLE_EXPORT_TTL_MS. An export
 * reads every table holding the user's data, so it is cheap to abuse.
 */
export const exportThrottle = {
  default: {
    ttl: num('THROTTLE_EXPORT_TTL_MS', 3_600_000),
    limit: num('THROTTLE_EXPORT_LIMIT', 3),
  },
};

/** Guess endpoint: THROTTLE_GUESS_LIMIT per THROTTLE_GUESS_TTL_MS. */
export const guessThrottle = {
  default: {
    ttl: num('THROTTLE_GUESS_TTL_MS', 60_000),
    limit: num('THROTTLE_GUESS_LIMIT', 30),
  },
};

/**
 * WebSocket per-socket, per-event token bucket.
 * WS_RATE_LIMIT_CAPACITY: burst size; WS_RATE_LIMIT_REFILL_PER_SEC: sustained rate.
 * WS_RATE_LIMIT_DISCONNECT_AFTER: consecutive rejected messages before disconnect.
 */
export const wsRateLimit = () => ({
  capacity: num('WS_RATE_LIMIT_CAPACITY', 20),
  refillPerSec: num('WS_RATE_LIMIT_REFILL_PER_SEC', 5),
  disconnectAfter: num('WS_RATE_LIMIT_DISCONNECT_AFTER', 50),
});

/** WebSocket max message size in bytes (WS_MAX_HTTP_BUFFER_SIZE, default 16 KB). */
export const wsMaxHttpBufferSize = () => num('WS_MAX_HTTP_BUFFER_SIZE', 16 * 1024);

/** Maximum concurrent sockets per user (WS_MAX_SOCKETS_PER_USER, default 5). */
export const wsMaxSocketsPerUser = () => num('WS_MAX_SOCKETS_PER_USER', 5);
