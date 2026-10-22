import { readFileSync } from 'fs';
import type { LoggingOptions } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * The one place Postgres connection options are built (issue R2-102). Used by
 * AppModule, the TypeORM CLI data source (typeorm.config.ts) and the seed, so
 * all three connect the same way.
 *
 * Connection: DATABASE_URL when set (postgres://user:pass@host:port/db),
 * otherwise DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_NAME.
 *
 * TLS: DB_SSL is one of
 *   disable      no TLS (default)
 *   require      TLS, server certificate not verified (most managed hosts)
 *   verify-full  TLS, certificate verified against DB_SSL_CA, or the system
 *                CAs when DB_SSL_CA is unset
 * When DB_SSL is unset, an sslmode in DATABASE_URL is used instead.
 * DB_SSL_CA is either the PEM itself (literal "\n" sequences are accepted,
 * for platforms that cannot hold multi-line values) or a path to a PEM file.
 */

/** Reads one variable; AppModule passes ConfigService, the CLI process.env. */
export type EnvReader = (key: string) => string | number | undefined;

export const envFromRecord =
  (record: Record<string, string | undefined>): EnvReader =>
  (key) =>
    record[key];

export type SslMode = 'disable' | 'require' | 'verify-full';
const SSL_MODES: readonly SslMode[] = ['disable', 'require', 'verify-full'];

export type SslOptions = false | { rejectUnauthorized: boolean; ca?: string };

export interface ConnectionTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface BuildDataSourceExtras {
  entities: PostgresConnectionOptions['entities'];
  migrations?: PostgresConnectionOptions['migrations'];
}

function read(env: EnvReader, key: string): string | undefined {
  const value = env(key);
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/** Parses postgres:// or postgresql:// URLs. Throws on anything else. */
export function parseDatabaseUrl(
  url: string,
): ConnectionTarget & { sslMode?: SslMode } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database) {
    throw new Error('DATABASE_URL must include a host and a database name');
  }

  const sslParam = parsed.searchParams.get('sslmode') ?? undefined;
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    // libpq's prefer/allow/verify-ca are mapped to the nearest mode.
    sslMode:
      sslParam === undefined
        ? undefined
        : sslParam === 'disable'
          ? 'disable'
          : sslParam === 'verify-full' || sslParam === 'verify-ca'
            ? 'verify-full'
            : 'require',
  };
}

/** DB_SSL / DB_SSL_CA (or the URL's sslmode) as the pg driver's ssl option. */
export function buildSslOptions(
  env: EnvReader,
  urlSslMode?: SslMode,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): SslOptions {
  const configured = read(env, 'DB_SSL');
  if (configured !== undefined && !SSL_MODES.includes(configured as SslMode)) {
    throw new Error(`DB_SSL must be one of ${SSL_MODES.join(', ')}`);
  }
  const mode = (configured as SslMode | undefined) ?? urlSslMode ?? 'disable';

  if (mode === 'disable') {
    return false;
  }

  const caSetting = read(env, 'DB_SSL_CA');
  const ca = caSetting
    ? caSetting.includes('-----BEGIN')
      ? caSetting.replace(/\\n/g, '\n')
      : readFile(caSetting)
    : undefined;

  return {
    rejectUnauthorized: mode === 'verify-full',
    ...(ca ? { ca } : {}),
  };
}

/** The primary connection, from DATABASE_URL or the discrete variables. */
export function resolveConnectionTarget(
  env: EnvReader,
): ConnectionTarget & { sslMode?: SslMode } {
  const url = read(env, 'DATABASE_URL');
  if (url) {
    return parseDatabaseUrl(url);
  }

  const missing = ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'].filter(
    (key) => read(env, key) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Database is not configured: set DATABASE_URL, or ${missing.join(', ')}`,
    );
  }

  return {
    host: read(env, 'DB_HOST')!,
    port: parseInt(read(env, 'DB_PORT') ?? '5432', 10),
    username: read(env, 'DB_USERNAME')!,
    password: read(env, 'DB_PASSWORD')!,
    database: read(env, 'DB_NAME')!,
  };
}

/**
 * DB_LOGGING: 'all', 'false', or a comma-separated list of query, error,
 * schema, warn, info, log, slow. Default 'error' in production, otherwise
 * 'error,warn,slow'.
 */
export function parseLogging(env: EnvReader): LoggingOptions {
  const isProduction = read(env, 'NODE_ENV') === 'production';
  const raw =
    read(env, 'DB_LOGGING') ?? (isProduction ? 'error' : 'error,warn,slow');
  if (raw === 'all') {
    return 'all';
  }
  if (raw === 'false') {
    return false;
  }
  return raw.split(',').map((level) => level.trim()) as LoggingOptions;
}

export function buildDataSourceOptions(
  env: EnvReader,
  extras: BuildDataSourceExtras,
): PostgresConnectionOptions {
  const { sslMode, ...primary } = resolveConnectionTarget(env);
  const ssl = buildSslOptions(env, sslMode);

  // Replication is only configured when DB_REPLICA_HOST is set, so a
  // single-database setup has no replication layer at all. The replica uses
  // the same TLS settings as the primary.
  const replicaHost = read(env, 'DB_REPLICA_HOST');
  const replicaPort = read(env, 'DB_REPLICA_PORT');
  const connection = replicaHost
    ? {
        replication: {
          master: { ...primary, ssl },
          slaves: [
            {
              host: replicaHost,
              port: replicaPort ? parseInt(replicaPort, 10) : primary.port,
              username: read(env, 'DB_REPLICA_USERNAME') ?? primary.username,
              password: read(env, 'DB_REPLICA_PASSWORD') ?? primary.password,
              database: read(env, 'DB_REPLICA_NAME') ?? primary.database,
              ssl,
            },
          ],
          // Every query goes to the primary by default, so write-then-read
          // flows (wagers, balances, auth) never see replica lag. The replica
          // is used only by code that explicitly opens a
          // `dataSource.createQueryRunner('slave')`.
          defaultMode: 'master' as const,
        },
      }
    : { ...primary, ssl };

  return {
    type: 'postgres',
    ...connection,
    entities: extras.entities,
    ...(extras.migrations ? { migrations: extras.migrations } : {}),
    synchronize: false,
    logging: parseLogging(env),
    maxQueryExecutionTime: Number(read(env, 'DB_SLOW_QUERY_THRESHOLD_MS') ?? 250),
    extra: {
      // 'max' is the pg pool option; TypeORM's poolSize is also accepted but
      // extra.max is the canonical pg-pool key.
      max: Number(read(env, 'DB_POOL_SIZE') ?? 10),
    },
  };
}
