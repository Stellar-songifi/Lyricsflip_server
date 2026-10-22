import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * #352: the image must be able to run migrations without ts-node or the
 * TypeScript sources, so the data source is compiled into dist/ with globs
 * relative to its own directory, and docker-entrypoint.sh exists.
 */

const ROOT = join(__dirname, '..');
const ORIGINAL_ENV = { ...process.env };

function loadDataSourceModule(env: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...env };
  let mod: typeof import('./data-source') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('./data-source');
  });
  return mod!;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('data source (#352)', () => {
  it('resolves entities and migrations relative to its own directory', () => {
    const mod = loadDataSourceModule({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    });
    expect(mod.entityGlobs).toEqual([
      join(__dirname, '**', '*.entity{.ts,.js}'),
    ]);
    expect(mod.migrationGlobs).toEqual([
      join(__dirname, 'migrations', '*{.ts,.js}'),
    ]);
    expect(mod.default.options.synchronize).toBe(false);
  });

  it('prefers DATABASE_URL and otherwise uses the DB_* variables', () => {
    const viaUrl = loadDataSourceModule({
      DATABASE_URL: 'postgres://u:p@db:5432/x',
    });
    expect(viaUrl.connectionOptions()).toEqual({
      type: 'postgres',
      url: 'postgres://u:p@db:5432/x',
    });

    const viaParts = loadDataSourceModule({
      DATABASE_URL: undefined,
      DB_HOST: 'db',
      DB_PORT: '6543',
      DB_USERNAME: 'u',
      DB_PASSWORD: 'p',
      DB_NAME: 'x',
    });
    expect(viaParts.connectionOptions()).toEqual({
      type: 'postgres',
      host: 'db',
      port: 6543,
      username: 'u',
      password: 'p',
      database: 'x',
    });
  });

  it('names the missing variable', () => {
    expect(() =>
      loadDataSourceModule({
        DATABASE_URL: undefined,
        DB_HOST: undefined,
        DB_USERNAME: 'u',
        DB_PASSWORD: 'p',
        DB_NAME: 'x',
      }),
    ).toThrow('Environment variable DB_HOST not set');
  });

  it('is compiled into dist/ (inside src/, not the repo root)', () => {
    expect(existsSync(join(__dirname, 'data-source.ts'))).toBe(true);
    const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).not.toContain('typeorm.config.ts');
  });
});

describe('docker image (#352)', () => {
  const entrypoint = join(ROOT, 'docker-entrypoint.sh');
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

  it('ships an executable entrypoint that migrates with the compiled data source', () => {
    expect(existsSync(entrypoint)).toBe(true);
    expect(statSync(entrypoint).mode & 0o111).not.toBe(0);
    const script = readFileSync(entrypoint, 'utf8');
    expect(script).toContain(
      'node node_modules/typeorm/cli.js migration:run -d dist/data-source.js',
    );
    expect(script).toMatch(/RUN_MIGRATIONS:-false\}" = "true"/);
    expect(script.trimEnd().endsWith('exec "$@"')).toBe(true);
  });

  it('copies the entrypoint and probes /health/live', () => {
    expect(dockerfile).toContain(
      'COPY docker-entrypoint.sh ./docker-entrypoint.sh',
    );
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/health\/live/);
    expect(dockerfile).toContain('ENV HOST=0.0.0.0');
  });
});
