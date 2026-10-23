import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { configureApp } from '../../src/app.setup';

/** Defaults match the CI Postgres service; override with DB_* locally. */
const DEFAULT_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'test',
  JWT_SECRET: 'e2e-jwt-secret-e2e-jwt-secret-e2e-jwt-secret',
};

export interface DbApp {
  app: INestApplication;
  dataSource: DataSource;
}

/**
 * Boots the real AppModule against a real Postgres. Migrations run once per
 * suite; call `truncateAll` in `beforeEach` to isolate tests.
 */
export async function createDbApp(): Promise<DbApp> {
  for (const [key, value] of Object.entries(DEFAULT_ENV)) {
    process.env[key] ??= value;
  }
  // Imported lazily so the env above is in place before config validation.
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const dataSource = app.get(DataSource);
  await dataSource.runMigrations();
  return { app, dataSource };
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas
    .map((m) => `"${m.tableName}"`)
    .join(', ');
  await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
