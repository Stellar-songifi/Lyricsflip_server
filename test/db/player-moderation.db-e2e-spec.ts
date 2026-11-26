import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { usernameRuleViolation } from '../../src/common/validators/username.validator';
import { GameSession } from '../../src/game-sessions/entities/game-session.entity';
import { CreateUserBlocks1794300000002 } from '../../src/migrations/1794300000002-CreateUserBlocks';
import { CreatePlayerReports1794300000004 } from '../../src/migrations/1794300000004-CreatePlayerReports';
import { assertPlayersCanInteract } from '../../src/moderation/player-blocks';
import {
  listPlayerReports,
  resolvePlayerReport,
  submitPlayerReport,
} from '../../src/moderation/player-report.store';
import { UserBlock } from '../../src/moderation/user-block.entity';
import { User } from '../../src/users/entities/user.entity';

describe('Player moderation persistence', () => {
  const schema = `moderation_test_${randomUUID().replaceAll('-', '')}`;
  const reporterId = randomUUID();
  const playerId = randomUUID();
  let db: DataSource;
  let runner: QueryRunner;

  beforeAll(async () => {
    db = await new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/test',
      schema,
      extra: { options: `-c search_path=${schema},public` },
      entities: [User, GameSession, UserBlock],
    }).initialize();
    runner = db.createQueryRunner();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(
      'CREATE TABLE users (id uuid PRIMARY KEY, "isActive" boolean NOT NULL DEFAULT true)',
    );
    await runner.query('INSERT INTO users (id) VALUES ($1), ($2)', [
      reporterId,
      playerId,
    ]);
    await new CreateUserBlocks1794300000002().up(runner);
    await new CreatePlayerReports1794300000004().up(runner);
  });

  afterAll(async () => {
    if (!runner) return;
    await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await runner.release();
    await db.destroy();
  });

  it('refuses blocked interactions in either direction with one neutral error', async () => {
    const block = { blockerId: reporterId, blockedId: playerId };
    await db.manager.insert(UserBlock, block);
    for (const [first, second] of [
      [reporterId, playerId],
      [playerId, reporterId],
    ]) {
      await expect(
        assertPlayersCanInteract(db.manager, first, second),
      ).rejects.toMatchObject({
        status: 403,
        message: 'This interaction is unavailable',
      });
    }

    await db.manager.delete(UserBlock, block);
    await expect(
      assertPlayersCanInteract(db.manager, reporterId, playerId),
    ).resolves.toBeUndefined();
  });

  it('deduplicates open player reports and allows admin resolution', async () => {
    const report = { reason: 'harassment', note: 'Repeated messages' };
    await Promise.all([
      submitPlayerReport(db.manager, reporterId, playerId, report),
      submitPlayerReport(db.manager, reporterId, playerId, report),
    ]);
    const queue = await listPlayerReports(db.manager, {});
    expect(queue.meta.total).toBe(1);
    expect(queue.data[0]).toMatchObject({ playerId, status: 'open' });
    await resolvePlayerReport(db.manager, queue.data[0].id, reporterId, {
      status: 'resolved',
    });
    await expect(listPlayerReports(db.manager, {})).resolves.toMatchObject({
      meta: { total: 0 },
    });
  });

  it('rejects configured terms with mixed case, leetspeak and separators', () => {
    const old = process.env.USERNAME_DENY_LIST;
    process.env.USERNAME_DENY_LIST = 'badword';
    try {
      expect(usernameRuleViolation('B4d_w0rd')).toBe(
        'This username is unavailable',
      );
      expect(usernameRuleViolation('Alice_123')).toBeNull();
    } finally {
      if (old === undefined) delete process.env.USERNAME_DENY_LIST;
      else process.env.USERNAME_DENY_LIST = old;
    }
  });
});
