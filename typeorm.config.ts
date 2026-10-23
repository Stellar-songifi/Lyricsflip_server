import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config(); // Load .env file

// Helper function to get environment variables or throw an error if they are not set.
function getEnv(key: string): string {
  const value = process.env[key];
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${key} not set`);
  }
  return value;
}

export default new DataSource({
  type: 'postgres',
  host: getEnv('DB_HOST'),
  port: parseInt(getEnv('DB_PORT'), 10),
  username: getEnv('DB_USERNAME'),
  password: getEnv('DB_PASSWORD'),
  database: getEnv('DB_NAME'),
  entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  synchronize: false,
  extra: { options: '-c timezone=UTC' },
});
