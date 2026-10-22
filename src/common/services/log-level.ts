/**
 * LOG_LEVEL handling shared by the env schema and the Winston logger (#359).
 *
 * LOG_LEVEL is passed to `winston.createLogger({ level })`, so it must be a
 * Winston level. Winston has no `log` level: with `level: 'log'` it drops
 * every message, errors included. `log` is Nest's name for Winston's `info`,
 * so it is still accepted for compatibility and mapped to `info`.
 */

/** Winston's npm levels, most to least severe (silly is deliberately omitted). */
export const WINSTON_LOG_LEVELS = [
  'error',
  'warn',
  'info',
  'http',
  'verbose',
  'debug',
] as const;

export type WinstonLogLevel = (typeof WINSTON_LOG_LEVELS)[number];

/** Every value LOG_LEVEL accepts: the Winston levels plus Nest's `log`. */
export const ACCEPTED_LOG_LEVELS = [...WINSTON_LOG_LEVELS, 'log'] as const;

/** Default level: info in production, debug everywhere else. */
export function defaultLogLevel(nodeEnv: string | undefined): WinstonLogLevel {
  return nodeEnv === 'production' ? 'info' : 'debug';
}

/**
 * The Winston level for a LOG_LEVEL value. `log` maps to `info`; an unset
 * or unrecognised value falls back to the environment default rather than
 * silencing the logger.
 */
export function resolveLogLevel(
  raw: string | undefined,
  nodeEnv: string | undefined,
): WinstonLogLevel {
  const value = raw?.trim().toLowerCase();
  if (value === 'log') return 'info';
  if (value && (WINSTON_LOG_LEVELS as readonly string[]).includes(value))
    return value as WinstonLogLevel;
  return defaultLogLevel(nodeEnv);
}
