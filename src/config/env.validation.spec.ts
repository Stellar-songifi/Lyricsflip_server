import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { envValidationSchema } from './env.validation';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|e2e-spec)\.ts$/.test(name)
      ? [path]
      : [];
  });
}

describe('env validation schema', () => {
  const schemaKeys = new Set(Object.keys(envValidationSchema.describe().keys));
  const envExample = readFileSync(
    join(__dirname, '../../.env.example'),
    'utf8',
  );

  it('covers every process.env.X read in src/', () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /process\.env(?:\.|\[\s*['"])([A-Z][A-Z0-9_]*)/g,
      )) {
        if (!schemaKeys.has(m[1])) missing.add(`${m[1]} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('covers variables read through helpers with dynamic names', () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /\b(?:envInt|num)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
      )) {
        if (!schemaKeys.has(m[1])) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('documents the tuning variables in .env.example', () => {
    for (const key of [
      'HOST',
      'TRUST_PROXY',
      'SETTLEMENT_DRAIN_TIMEOUT_MS',
      'STELLAR_TRY_AGAIN_MAX_ATTEMPTS',
      'STELLAR_TRY_AGAIN_BASE_DELAY_MS',
      'STELLAR_POLL_ATTEMPTS',
      'STELLAR_POLL_SLEEP_STRATEGY',
      'WAGER_RECONCILE_MIN_AGE_SECONDS',
      'WAGER_RECONCILE_MAX_ATTEMPTS',
      'WAGER_RECONCILE_BASE_DELAY_SECONDS',
      'LYRIC_TOKEN_DECIMALS',
      'METRICS_IP_ALLOWLIST',
      'METRICS_BASIC_AUTH',
      'THROTTLE_LIMIT',
    ]) {
      expect(envExample).toContain(key);
    }
  });
});
