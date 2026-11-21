/**
 * Production safety checks.
 *
 * `runProductionSafetyCheck` is a pure function of `process.env` (or any
 * environment object passed to it). It returns a list of human-readable
 * problems; an empty array means the environment is safe to boot in
 * production. `main.ts` is responsible for throwing a single aggregated
 * error listing every problem.
 *
 * See ISSUES-ROUND-3.md (R3-15) for the full list of documented checks.
 */

/** Minimum acceptable length for `JWT_SECRET`. */
export const JWT_SECRET_MIN_LENGTH = 32;

/** Minimum acceptable Shannon entropy (bits per character) for `JWT_SECRET`. */
export const JWT_SECRET_MIN_ENTROPY = 3.5;

/** Default seed admin password that must never reach production. */
export const DEFAULT_SEED_ADMIN_PASSWORD = 'admin';

/** Values that count as "not set" for boolean-ish configuration flags. */
const FALSY_FLAG_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Compute the Shannon entropy of a string in bits per character.
 * Returns 0 for an empty string.
 */
export function shannonEntropy(value: string): number {
  if (!value) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function isFlagEnabled(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return !FALSY_FLAG_VALUES.has(value.trim().toLowerCase());
}

/**
 * Parse an integer-ish environment value. Returns `undefined` when the value
 * is missing or not a finite number.
 */
function parseInteger(value: string | undefined): number | undefined {
  if (isBlank(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Determine whether more than one application instance is expected.
 *
 * Signals considered:
 *  - `INSTANCE_COUNT` > 1
 *  - `WEB_CONCURRENCY` > 1 (common on Heroku-style platforms)
 *  - `REPLICA_COUNT` > 1
 */
function expectsMultipleInstances(env: NodeJS.ProcessEnv): boolean {
  const candidates = [
    parseInteger(env.INSTANCE_COUNT),
    parseInteger(env.WEB_CONCURRENCY),
    parseInteger(env.REPLICA_COUNT),
  ];

  return candidates.some((count) => count !== undefined && count > 1);
}

/**
 * Run every production safety check against `env` and return the list of
 * problems found. The returned array is empty when the environment is safe.
 *
 * This function never throws; callers decide how to surface the problems.
 */
export function runProductionSafetyCheck(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];

  // 1. Metrics endpoint protection: either an IP allowlist or basic auth.
  const hasMetricsIpAllowlist = !isBlank(env.METRICS_IP_ALLOWLIST);
  const hasMetricsBasicAuth =
    !isBlank(env.METRICS_BASIC_AUTH) ||
    (!isBlank(env.METRICS_BASIC_AUTH_USER) &&
      !isBlank(env.METRICS_BASIC_AUTH_PASSWORD));

  if (!hasMetricsIpAllowlist && !hasMetricsBasicAuth) {
    problems.push(
      'METRICS_IP_ALLOWLIST or METRICS_BASIC_AUTH must be set to protect the metrics endpoint.',
    );
  }

  // 2. FRONTEND_URL must be set (used for CORS and links in emails).
  if (isBlank(env.FRONTEND_URL)) {
    problems.push('FRONTEND_URL must be set.');
  }

  // 3. SWAGGER_ENABLED must be set explicitly in production.
  if (env.SWAGGER_ENABLED === undefined) {
    problems.push(
      'SWAGGER_ENABLED must be set explicitly (e.g. "false") in production.',
    );
  }

  // 4. SEP-10 signing key and resolver key must not be reused.
  const sep10Key = env.SEP10_SIGNING_SECRET ?? env.SEP10_SIGNING_KEY;
  const resolverKey = env.STELLAR_RESOLVER_SECRET ?? env.STELLAR_RESOLVER_KEY;
  if (
    !isBlank(sep10Key) &&
    !isBlank(resolverKey) &&
    sep10Key === resolverKey
  ) {
    problems.push(
      'SEP10_SIGNING_SECRET and STELLAR_RESOLVER_SECRET must not be the same key.',
    );
  }

  // 5. Seed admin password must not be left at its default.
  const seedAdminPassword =
    env.SEED_ADMIN_PASSWORD ?? env.ADMIN_SEED_PASSWORD;
  if (
    !isBlank(seedAdminPassword) &&
    seedAdminPassword === DEFAULT_SEED_ADMIN_PASSWORD
  ) {
    problems.push(
      `SEED_ADMIN_PASSWORD must not be left at its default value ("${DEFAULT_SEED_ADMIN_PASSWORD}").`,
    );
  }

  // 6. JWT_SECRET length and entropy.
  const jwtSecret = env.JWT_SECRET;
  if (isBlank(jwtSecret)) {
    problems.push('JWT_SECRET must be set.');
  } else {
    if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
      problems.push(
        `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters long.`,
      );
    }
    if (shannonEntropy(jwtSecret) < JWT_SECRET_MIN_ENTROPY) {
      problems.push(
        `JWT_SECRET must have sufficient entropy (at least ${JWT_SECRET_MIN_ENTROPY} bits per character).`,
      );
    }
  }

  // 7. DAILY_CHALLENGE_SALT must be set (R3-51).
  if (isBlank(env.DAILY_CHALLENGE_SALT)) {
    problems.push('DAILY_CHALLENGE_SALT must be set.');
  }

  // 8. TRUST_PROXY must be set when METRICS_IP_ALLOWLIST is used.
  if (hasMetricsIpAllowlist && isBlank(env.TRUST_PROXY)) {
    problems.push(
      'TRUST_PROXY must be set when METRICS_IP_ALLOWLIST is used.',
    );
  }

  // 9. REDIS_URL must be set when more than one instance is expected (R3-46, R3-47).
  if (expectsMultipleInstances(env) && isBlank(env.REDIS_URL)) {
    problems.push(
      'REDIS_URL must be set when more than one instance is expected.',
    );
  }

  return problems;
}

export default runProductionSafetyCheck;