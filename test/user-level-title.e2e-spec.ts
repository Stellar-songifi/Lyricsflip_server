import { randomUUID } from 'crypto';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User, UserLevel } from '../src/users/entities/user.entity';
import { GameSession } from '../src/game-sessions/entities/game-session.entity';
import { RenameGossipGodToGossipGuru1790363500000 } from '../src/migrations/1790363500000-RenameGossipGodToGossipGuru';

// Needs a Postgres server reachable with the DB_* variables. The test creates
// and drops its own database, so DB_NAME is only used to connect.
const connection = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
} as const;

describe('User level titles (e2e)', () => {
  const database = `level_title_test_${randomUUID().replace(/-/g, '')}`;
  let admin: DataSource;
  let dataSource: DataSource;

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: process.env.DB_NAME });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);

    dataSource = new DataSource({
      ...connection,
      database,
      entities: [User, GameSession],
      migrations: [RenameGossipGodToGossipGuru1790363500000],
    } as DataSourceOptions);
    await dataSource.initialize();

    // The level enum as the stray root-level migration created it.
    await dataSource.query(
      `CREATE TYPE "public"."users_leveltitle_enum" AS ENUM('Gossip Rookie', 'Word Whisperer', 'Lyric Sniper', 'Bar Genius', 'Gossip God')`,
    );
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin?.destroy();
  });

  it('leaves the level enum matching UserLevel exactly', async () => {
    const rows: { enumlabel: string }[] = await dataSource.query(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'users_leveltitle_enum'
      ORDER BY e.enumsortorder
    `);

    expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(UserLevel));
  });

  it('is a no-op when run again', async () => {
    const queryRunner = dataSource.createQueryRunner();
    try {
      await expect(
        new RenameGossipGodToGossipGuru1790363500000().up(queryRunner),
      ).resolves.toBeUndefined();
    } finally {
      await queryRunner.release();
    }
  });

  describe('saving users', () => {
    beforeAll(() => dataSource.synchronize());

    it.each(Object.values(UserLevel))(
      'saves a user titled %s',
      async (title) => {
        const users = dataSource.getRepository(User);
        const suffix = randomUUID();

        const { id } = await users.save(
          users.create({
            email: `${suffix}@example.com`,
            username: suffix,
            passwordHash: 'hash',
            levelTitle: title,
          }),
        );

        await expect(users.findOneByOrFail({ id })).resolves.toMatchObject({
          levelTitle: title,
        });
      },
    );
  });
});
