import {
  buildDataSourceOptions,
  buildSslOptions,
  envFromRecord,
  parseDatabaseUrl,
  resolveConnectionTarget,
} from './database.config';

const entities = ['entities'];

describe('parseDatabaseUrl', () => {
  it('reads every part of a postgres URL', () => {
    expect(
      parseDatabaseUrl('postgres://app:s3cret@db.example.com:6543/lyrics'),
    ).toEqual({
      host: 'db.example.com',
      port: 6543,
      username: 'app',
      password: 's3cret',
      database: 'lyrics',
      sslMode: undefined,
    });
  });

  it('defaults the port and decodes escaped credentials', () => {
    const target = parseDatabaseUrl(
      'postgresql://us%40er:p%2Fss%3Aword@localhost/my%20db',
    );
    expect(target).toMatchObject({
      port: 5432,
      username: 'us@er',
      password: 'p/ss:word',
      database: 'my db',
    });
  });

  it('maps libpq sslmode values', () => {
    expect(parseDatabaseUrl('postgres://a:b@h/d?sslmode=require').sslMode).toBe(
      'require',
    );
    expect(parseDatabaseUrl('postgres://a:b@h/d?sslmode=prefer').sslMode).toBe(
      'require',
    );
    expect(
      parseDatabaseUrl('postgres://a:b@h/d?sslmode=verify-ca').sslMode,
    ).toBe('verify-full');
    expect(parseDatabaseUrl('postgres://a:b@h/d?sslmode=disable').sslMode).toBe(
      'disable',
    );
  });

  it('rejects other schemes and URLs without a database', () => {
    expect(() => parseDatabaseUrl('mysql://a:b@h/d')).toThrow(/postgres/);
    expect(() => parseDatabaseUrl('postgres://a:b@h')).toThrow(/database/);
    expect(() => parseDatabaseUrl('not a url')).toThrow(/valid URL/);
  });
});

describe('resolveConnectionTarget', () => {
  const discrete = {
    DB_HOST: 'localhost',
    DB_PORT: '5433',
    DB_USERNAME: 'user',
    DB_PASSWORD: 'pass',
    DB_NAME: 'lyricflip',
  };

  it('uses the discrete variables when DATABASE_URL is unset', () => {
    expect(resolveConnectionTarget(envFromRecord(discrete))).toEqual({
      host: 'localhost',
      port: 5433,
      username: 'user',
      password: 'pass',
      database: 'lyricflip',
    });
  });

  it('prefers DATABASE_URL over the discrete variables', () => {
    const env = envFromRecord({
      ...discrete,
      DATABASE_URL: 'postgres://u:p@managed.example.com:5432/prod',
    });
    expect(resolveConnectionTarget(env)).toMatchObject({
      host: 'managed.example.com',
      database: 'prod',
    });
  });

  it('names the missing variables', () => {
    expect(() =>
      resolveConnectionTarget(envFromRecord({ DB_HOST: 'localhost' })),
    ).toThrow(/DB_USERNAME, DB_PASSWORD, DB_NAME/);
  });
});

describe('buildSslOptions', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';

  it('is off by default', () => {
    expect(buildSslOptions(envFromRecord({}))).toBe(false);
  });

  it('require encrypts without verifying the certificate', () => {
    expect(buildSslOptions(envFromRecord({ DB_SSL: 'require' }))).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('verify-full verifies, with an inline PEM', () => {
    const escaped = pem.replace(/\n/g, '\\n');
    expect(
      buildSslOptions(
        envFromRecord({ DB_SSL: 'verify-full', DB_SSL_CA: escaped }),
      ),
    ).toEqual({ rejectUnauthorized: true, ca: pem });
  });

  it('reads DB_SSL_CA from a file when it is a path', () => {
    const readFile = jest.fn().mockReturnValue(pem);
    expect(
      buildSslOptions(
        envFromRecord({ DB_SSL: 'verify-full', DB_SSL_CA: '/certs/ca.pem' }),
        undefined,
        readFile,
      ),
    ).toEqual({ rejectUnauthorized: true, ca: pem });
    expect(readFile).toHaveBeenCalledWith('/certs/ca.pem');
  });

  it('falls back to the URL sslmode, and DB_SSL overrides it', () => {
    expect(buildSslOptions(envFromRecord({}), 'require')).toEqual({
      rejectUnauthorized: false,
    });
    expect(
      buildSslOptions(envFromRecord({ DB_SSL: 'disable' }), 'require'),
    ).toBe(false);
  });

  it('rejects unknown modes', () => {
    expect(() => buildSslOptions(envFromRecord({ DB_SSL: 'yes' }))).toThrow(
      /DB_SSL must be one of/,
    );
  });
});

describe('buildDataSourceOptions', () => {
  it('connects with only DATABASE_URL and DB_SSL=require', () => {
    const options = buildDataSourceOptions(
      envFromRecord({
        DATABASE_URL: 'postgres://u:p@managed.example.com:5432/prod',
        DB_SSL: 'require',
      }),
      { entities },
    );
    expect(options).toMatchObject({
      type: 'postgres',
      host: 'managed.example.com',
      port: 5432,
      username: 'u',
      password: 'p',
      database: 'prod',
      ssl: { rejectUnauthorized: false },
      entities,
      synchronize: false,
    });
  });

  it('applies pool, logging and slow-query settings', () => {
    const options = buildDataSourceOptions(
      envFromRecord({
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        DB_POOL_SIZE: '25',
        DB_LOGGING: 'query,error',
        DB_SLOW_QUERY_THRESHOLD_MS: '500',
      }),
      { entities, migrations: ['migrations'] },
    );
    expect(options).toMatchObject({
      extra: { max: 25 },
      logging: ['query', 'error'],
      maxQueryExecutionTime: 500,
      migrations: ['migrations'],
    });
  });

  it('gives the replica the primary TLS settings and defaults', () => {
    const options = buildDataSourceOptions(
      envFromRecord({
        DATABASE_URL: 'postgres://u:p@primary:5432/d',
        DB_SSL: 'require',
        DB_REPLICA_HOST: 'replica',
      }),
      { entities },
    ) as unknown as {
      replication: {
        master: Record<string, unknown>;
        slaves: Record<string, unknown>[];
      };
    };
    expect(options.replication.master).toMatchObject({
      host: 'primary',
      ssl: { rejectUnauthorized: false },
    });
    expect(options.replication.slaves[0]).toEqual({
      host: 'replica',
      port: 5432,
      username: 'u',
      password: 'p',
      database: 'd',
      ssl: { rejectUnauthorized: false },
    });
  });
});
