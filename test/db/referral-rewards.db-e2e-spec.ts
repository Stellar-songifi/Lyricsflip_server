import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { AddReferralAttribution1794300000001 } from '../../src/migrations/1794300000001-AddReferralAttribution';
import { AddReferralRewards1794300000003 } from '../../src/migrations/1794300000003-AddReferralRewards';
import {
  recordReferralRound,
  ReferralRewardsService,
} from '../../src/referrals/referral-rewards.service';

describe('Referral reward persistence', () => {
  const schema = `referral_test_${randomUUID().replaceAll('-', '')}`;
  let db: DataSource;
  let runner: QueryRunner;
  let service: ReferralRewardsService;
  let referrerId: string;
  let referredId: string;

  beforeAll(async () => {
    db = await new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/test',
      extra: { options: `-c search_path=${schema},public` },
    }).initialize();
    runner = db.createQueryRunner();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        "isActive" boolean NOT NULL DEFAULT true,
        "emailVerifiedAt" timestamptz
      )
    `);
    await new AddReferralAttribution1794300000001().up(runner);
    await new AddReferralRewards1794300000003().up(runner);
    service = new ReferralRewardsService(db);
  });

  afterAll(async () => {
    if (!runner) return;
    await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await runner.release();
    await db.destroy();
  });

  beforeEach(async () => {
    await runner.query('TRUNCATE users CASCADE');
    referrerId = randomUUID();
    referredId = randomUUID();
    await runner.query(
      'INSERT INTO users (id, "referredBy") VALUES ($1, NULL), ($2, $1)',
      [referrerId, referredId],
    );
  });

  const play = (lyricId: number, elapsedMs = 2000, roundId = randomUUID()) =>
    recordReferralRound(db.manager, {
      userId: referredId,
      roundId,
      lyricId,
      correctInTime: true,
      elapsedMs,
      snippet: 'The quick brown fox jumps over the lazy dog in the field',
    });

  const verify = () =>
    runner.query('UPDATE users SET "emailVerifiedAt" = now() WHERE id = $1', [
      referredId,
    ]);

  const awards = (): Promise<
    Array<{ referredId: string; referrerId: string }>
  > => runner.query('SELECT "referredId", "referrerId" FROM referral_rewards');

  it('awards once to both accounts only after email verification and qualifying rounds', async () => {
    const firstId = randomUUID();
    await play(1, 2000, firstId);
    await play(1, 2000, firstId);
    for (let lyric = 1; lyric < 10; lyric++) await play(lyric);
    await service.awardEligibleReferrals();
    expect(await awards()).toEqual([]);

    await play(10);
    await service.awardEligibleReferrals();
    expect(await awards()).toEqual([]);

    await verify();
    await Promise.all([
      service.awardEligibleReferrals(),
      service.awardEligibleReferrals(),
    ]);
    expect(await awards()).toEqual([{ referredId, referrerId }]);
  });

  it('withholds the award when three correct answers fall below the reading floor', async () => {
    await verify();
    for (let lyric = 1; lyric <= 10; lyric++) await play(lyric);
    for (let lyric = 11; lyric <= 13; lyric++) await play(lyric, 300);
    await service.awardEligibleReferrals();
    expect(await awards()).toEqual([]);
  });
});
