import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/auth/roles/role.enum';
import { User } from '../../src/users/entities/user.entity';
import { createDbApp, truncateAll } from './db-app';

describe('Wager read endpoints (real Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, dataSource } = await createDbApp());
  });

  beforeEach(() => truncateAll(dataSource));
  afterAll(async () => {
    await app?.close();
  });

  async function createUser(username: string, role = Role.User) {
    const email = `${username}@example.com`;
    const password = 'Str0ng!Passw0rd';
    await http()
      .post('/auth/signup')
      .send({ username, email, password })
      .expect(201);
    const users = dataSource.getRepository(User);
    await users.update(
      { username },
      { role, mockBalance: '100000000', emailVerifiedAt: new Date() },
    );
    const { body } = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return { id: body.user.id as string, auth: `Bearer ${body.accessToken}` };
  }

  it('shows both players their wager, stake deduction and rank, and restricts access', async () => {
    const alice = await createUser('wager_alice');
    const bob = await createUser('wager_bob');
    const outsider = await createUser('wager_outsider');
    const admin = await createUser('wager_admin', Role.Admin);

    await http()
      .get('/users/me/balance')
      .set('Authorization', alice.auth)
      .expect(200, { stroops: '100000000', display: '10.0' });
    await http()
      .get('/users/me/balance')
      .set('Authorization', bob.auth)
      .expect(200, { stroops: '100000000', display: '10.0' });

    const { body: session } = await http()
      .post('/game-sessions')
      .set('Authorization', alice.auth)
      .send({
        category: 'Pop',
        mode: 'wagered',
        playerTwoId: bob.id,
        wagerAmount: '2.5',
      })
      .expect(201);
    const wagerPath = `/game-sessions/${session.id}/wager`;
    await http()
      .get(wagerPath)
      .set('Authorization', bob.auth)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('awaiting_stakes'));
    await http()
      .post(`/game-sessions/${session.id}/accept`)
      .set('Authorization', bob.auth)
      .expect(200);

    for (const [player, opponentUsername] of [
      [alice, 'wager_bob'],
      [bob, 'wager_alice'],
    ] as const) {
      const { body: wager } = await http()
        .get(wagerPath)
        .set('Authorization', player.auth)
        .expect(200);
      expect(wager).toMatchObject({
        sessionId: session.id,
        opponentUsername,
        status: 'staked',
        stake: { stroops: '25000000', display: '2.5' },
        totalPot: { stroops: '50000000', display: '5.0' },
        claimDeadlineLedger: null,
      });
      expect(wager).not.toHaveProperty('playerA');
      expect(wager).not.toHaveProperty('playerAId');
      await http()
        .get('/wagers/me?limit=1&offset=0')
        .set('Authorization', player.auth)
        .expect(200, {
          data: [wager],
          meta: { total: 1, limit: 1, offset: 0, hasNext: false },
        });
      await http()
        .get('/wagers/me?limit=1&offset=1')
        .set('Authorization', player.auth)
        .expect(200, {
          data: [],
          meta: { total: 1, limit: 1, offset: 1, hasNext: false },
        });
      await http()
        .get('/users/me/balance')
        .set('Authorization', player.auth)
        .expect(200, { stroops: '75000000', display: '7.5' });
      await http()
        .get('/users/me/rank')
        .set('Authorization', player.auth)
        .expect(200, { rank: 1 });
    }

    await http().get(wagerPath).set('Authorization', outsider.auth).expect(403);
    await http().get(wagerPath).set('Authorization', admin.auth).expect(200);
    await http()
      .get('/game-sessions/invalid/wager')
      .set('Authorization', alice.auth)
      .expect(400);
    await http().get('/wagers/me').expect(401);
  });
});
