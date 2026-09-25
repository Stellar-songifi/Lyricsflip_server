import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { RoomsService } from '../src/rooms/rooms.service';
import {
  createTestApp,
  expectNoLeaks,
  PASSWORD_HASH,
  users,
} from './support/test-app';

/**
 * Every fixture user carries a password hash, email, balance and wallet.
 * These tests fail if any of that reaches a response it should not.
 */
describe('User data exposure (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, as: keyof typeof users = 'alice') =>
    request(app.getHttpServer()).get(path).set('x-test-user', as);

  describe('embedded users expose only public fields', () => {
    it.each([
      ['/game-sessions'],
      ['/game-sessions/top-scores'],
      ['/game-sessions/my-recent'],
      ['/game-sessions/session-1'],
      ['/game-sessions/wagers/my-history'],
      ['/game-sessions/session-1/wager'],
      ['/game-history/me'],
    ])('GET %s', async (path) => {
      const res = await get(path).expect(200);

      expectNoLeaks(res.body);
    });

    it('a game session’s player is id/username/stats only', async () => {
      const res = await get('/game-sessions/session-1').expect(200);

      expect(res.body.player).toEqual({
        id: users.alice.id,
        username: 'alice',
        xp: 120,
        level: 2,
        createdAt: users.alice.createdAt.toISOString(),
      });
    });

    // Called on the service directly: over HTTP every rooms route currently
    // 404s because @GetUser('id') returns the whole user (backlog issue #3).
    it('room members are summarised as id and username', async () => {
      const status = await app
        .get(RoomsService)
        .getRoomStatus('room-1', users.alice.id);

      expectNoLeaks(status);
      for (const member of status.roomUsers) {
        expect(Object.keys(member.user ?? {}).sort()).toEqual(['id', 'username']);
      }
    });
  });

  describe('user endpoints', () => {
    it('GET /users/:id returns the public profile only', async () => {
      const res = await get(`/users/${users.bob.id}`).expect(200);

      expect(res.body).toEqual({
        id: users.bob.id,
        username: 'bob',
        xp: 120,
        level: 2,
      });
      expectNoLeaks(res.body);
    });

    it('PATCH /users/me returns the caller’s own details but no hash', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('x-test-user', 'alice')
        .send({ name: 'Alice' })
        .expect(200);

      expect(res.body.email).toBe(users.alice.email);
      expectNoLeaks(res.body, true);
    });
  });

  describe('admin endpoints show private fields but never the hash', () => {
    it.each([['/users'], ['/admin/users']])('GET %s', async (path) => {
      const res = await get(path, 'admin').expect(200);

      expect(res.body[0].email).toBeDefined();
      expect(res.body[0].role).toBeDefined();
      expectNoLeaks(res.body, true);
    });

    it('GET /admin/lyrics does not embed the creator’s private data', async () => {
      const res = await get('/admin/lyrics', 'admin').expect(200);

      expect(JSON.stringify(res.body)).not.toContain(PASSWORD_HASH);
      expect(res.body[0].createdBy).not.toHaveProperty('email');
    });
  });
});
