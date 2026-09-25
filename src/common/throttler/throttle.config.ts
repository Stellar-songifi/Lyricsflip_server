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

/** Guess endpoint: THROTTLE_GUESS_LIMIT per THROTTLE_GUESS_TTL_MS. */
export const guessThrottle = {
  default: {
    ttl: num('THROTTLE_GUESS_TTL_MS', 60_000),
    limit: num('THROTTLE_GUESS_LIMIT', 30),
  },
};
