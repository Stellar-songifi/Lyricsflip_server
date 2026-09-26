import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, mocks, users } from './support/test-app';

type Who = keyof typeof users | undefined;

/**
 * Authorization for every /users route, as an anonymous caller, a normal
 * user (alice), the target user acting on themself (bob) and an admin.
 */
describe('Users authorization (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who: Who,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())[method](path);
    if (who) req.set('x-test-user', who);
    return body ? req.send(body) : req;
  };

  const bobPath = `/users/${users.bob.id}`;

  describe('GET /users (list every account)', () => {
    it('is 401 when not signed in', () => call('get', '/users', undefined).expect(401));
    it('is 403 for a normal user', () => call('get', '/users', 'alice').expect(403));
    it('is 200 for an admin', () => call('get', '/users', 'admin').expect(200));
  });

  describe('PATCH /users/:id', () => {
    it('is 403 when a user modifies someone else', async () => {
      await call('patch', bobPath, 'alice', { username: 'hijacked' }).expect(403);
      expect(mocks.usersService.update).not.toHaveBeenCalled();
    });

    it('is 403 for the owner too: self-service goes through /users/me', () =>
      call('patch', bobPath, 'bob', { username: 'bobby' }).expect(403));

    it('is 200 for an admin', async () => {
      await call('patch', bobPath, 'admin', { isActive: false }).expect(200);
      expect(mocks.usersService.update).toHaveBeenCalledWith(users.bob.id, {
        isActive: false,
      });
    });

    it('rejects fields outside the admin DTO', () =>
      call('patch', bobPath, 'admin', { passwordHash: 'x' }).expect(400));
  });

  describe('DELETE /users/:id', () => {
    it('is 403 when a user deletes someone else', async () => {
      await call('delete', bobPath, 'alice').expect(403);
      expect(mocks.usersService.remove).not.toHaveBeenCalled();
    });

    it('is 403 for the owner too: self-service goes through /users/me', () =>
      call('delete', bobPath, 'bob').expect(403));

    it('is 200 for an admin', async () => {
      await call('delete', bobPath, 'admin').expect(200);
      expect(mocks.usersService.remove).toHaveBeenCalledWith(users.bob.id);
    });
  });

  describe('PATCH /users/me', () => {
    it('updates the caller’s own account', async () => {
      await call('patch', '/users/me', 'alice', { username: 'alice2' }).expect(200);
      expect(mocks.usersService.update).toHaveBeenCalledWith(users.alice.id, {
        username: 'alice2',
      });
    });

    it('cannot change role or active status', async () => {
      await call('patch', '/users/me', 'alice', { role: 'admin' }).expect(400);
      await call('patch', '/users/me', 'alice', { isActive: true }).expect(400);
      expect(mocks.usersService.update).not.toHaveBeenCalled();
    });

    it('is 401 when not signed in', () =>
      call('patch', '/users/me', undefined, { name: 'x' }).expect(401));
  });

  describe('DELETE /users/me', () => {
    it('deletes only the caller’s own account', async () => {
      await call('delete', '/users/me', 'alice').expect(200);
      expect(mocks.usersService.remove).toHaveBeenCalledWith(users.alice.id);
    });

    it('is 401 when not signed in', () =>
      call('delete', '/users/me', undefined).expect(401));
  });

  describe('POST /users', () => {
    it('no longer exists; accounts are created through /auth/signup', () =>
      call('post', '/users', 'admin', { username: 'x' }).expect(404));
  });

  describe('routes open to any signed-in user', () => {
    it.each([
      ['get', bobPath],
      ['get', '/users/profile'],
      ['get', '/users/preferences'],
      ['get', '/users/leaderboard'],
    ] as const)('%s %s is 200', (method, path) =>
      call(method, path, 'alice').expect(200),
    );

    it('PATCH /users/preferences is 200', () =>
      call('patch', '/users/preferences', 'alice', {}).expect(200));

    it('GET /users/:id rejects a malformed ID with 400', () =>
      call('get', '/users/not-a-uuid', 'alice').expect(400));
  });
});
