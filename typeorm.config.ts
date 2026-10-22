import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import {
  buildDataSourceOptions,
  envFromRecord,
} from './src/config/database.config';

config(); // Load .env file

// The TypeORM CLI data source (migration:run, migration:check, ...). Built by
// the same function as AppModule's connection, so DATABASE_URL, DB_SSL and
// the replica settings apply here too.
export default new DataSource(
  buildDataSourceOptions(envFromRecord(process.env), {
    entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  }),
);
