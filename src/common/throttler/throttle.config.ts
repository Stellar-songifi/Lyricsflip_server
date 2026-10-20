/** Global default: THROTTLE_TTL_MS window, THROTTLE_LIMIT requests. */
export const defaultThrottle = () => ({ ttl: 60_000, limit: 100 });

/** Stricter limit for login/signup: THROTTLE_AUTH_LIMIT per THROTTLE_AUTH_TTL_MS. */
export const authThrottle = {
  default: {
    ttl: 60_000,
    limit: 5,
  },
};

/** SEP-10 endpoints: THROTTLE_STELLAR_LIMIT per THROTTLE_STELLAR_TTL_MS. */
export const stellarThrottle = {
  default: {
    ttl: 60_000,
    limit: 10,
  },
};

/** Guess endpoint: THROTTLE_GUESS_LIMIT per THROTTLE_GUESS_TTL_MS. */
export const guessThrottle = {
  default: {
    ttl: 60_000,
    limit: 30,
  },
};
