import 'reflect-metadata';
import { join } from 'path';
import { config } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

config(); // Load .env when present; the container passes real env vars.

/**
 * TypeORM data source for the CLI (migrations) (#352).
 *
 * Lives under src/ so `nest build` compiles it to dist/data-source.js, and
 * resolves its globs relative to its own directory. The same file works from
 * the TypeScript sources (`npm run migration:run`, via typeorm.config.ts)
 * and from the compiled image, where only dist/ exists:
 *
 *   node node_modules/typeorm/cli.js migration:run -d dist/data-source.js
 */

function getEnv(key: string): string {
  const value = process.env[key];
  if (typeof value === 'undefined' || value === '') {
    throw new Error(`Environment variable ${key} not set`);
  }
  return value;
}

/** Connection settings: DATABASE_URL when set, otherwise the discrete DB_* variables. */
export function connectionOptions(): Pick<
  DataSourceOptions & { type: 'postgres' },
  'type' | 'url' | 'host' | 'port' | 'username' | 'password' | 'database'
> {
  if (process.env.DATABASE_URL) {
    return { type: 'postgres', url: process.env.DATABASE_URL };
  }
  return {
    type: 'postgres',
    host: getEnv('DB_HOST'),
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: getEnv('DB_USERNAME'),
    password: getEnv('DB_PASSWORD'),
    database: getEnv('DB_NAME'),
  };
}

/** Entity and migration globs, relative to this file (src/ or dist/). */
export const entityGlobs = [join(__dirname, '**', '*.entity{.ts,.js}')];
export const migrationGlobs = [join(__dirname, 'migrations', '*{.ts,.js}')];

export default new DataSource({
  ...connectionOptions(),
  entities: entityGlobs,
  migrations: migrationGlobs,
  synchronize: false,
  // Sessions run in UTC so timestamptz values round-trip unchanged.
  extra: { options: '-c timezone=UTC' },
} as DataSourceOptions);
