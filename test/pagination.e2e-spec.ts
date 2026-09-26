import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, mocks, users } from './support/test-app';

/**
 * Every list endpoint must reject bad or oversized page values with 400
 * instead of passing NaN or an unbounded limit to the database.
 */
describe('Pagination (e2e)', () => {
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

  const get = (path: string, as: keyof typeof users = 'admin') =>
    request(app.getHttpServer()).get(path).set('x-test-user', as);

  // [path, service mock, expected call for ?limit=25&offset=50]
  const endpoints: [string, jest.Mock, unknown[]][] = [
    ['/game-sessions', mocks.gameSessionsService.findAll, [25, 50]],
    ['/game-sessions/top-scores', mocks.gameSessionsService.getTopScores, [25, 50]],
    ['/game-sessions/my-recent', mocks.gameSessionsService.getRecentGames, [users.admin.id, 25, 50]],
    ['/game-sessions/wagers/my-history', mocks.gameSessionsService.getUserWagers, [users.admin.id, 25, 50]],
    ['/users', mocks.usersService.findAll, [25, 50]],
    ['/users/leaderboard', mocks.usersService.getLeaderboard, [25, 50, 'xp', 'DESC']],
    ['/admin/users', mocks.adminService.findAllUsers, [25, 50]],
    ['/admin/lyrics', mocks.adminService.findAllLyrics, [25, 50]],
  ];

  const invalid = [
    ['limit=abc', 'not a number'],
    ['limit=NaN', 'NaN'],
    ['limit=1.5', 'a fraction'],
    ['limit=0', 'zero'],
    ['limit=-1', 'negative'],
    ['limit=101', 'one over the maximum'],
    ['limit=100000', 'far over the maximum'],
    ['offset=-1', 'a negative offset'],
    ['offset=abc', 'a non-numeric offset'],
  ];

  describe.each(endpoints)('GET %s', (path, serviceMethod, expectedArgs) => {
    it.each(invalid)('rejects ?%s (%s) with 400', async (query) => {
      await get(`${path}?${query}`).expect(400);
      expect(serviceMethod).not.toHaveBeenCalled();
    });

    it('passes valid values to the service as numbers', async () => {
      await get(`${path}?limit=25&offset=50`).expect(200);
      expect(serviceMethod).toHaveBeenCalledWith(...expectedArgs);
    });

    it('accepts the maximum page size', () => get(`${path}?limit=100`).expect(200));
  });

  describe('GET /game-history/me (paged by page number)', () => {
    it.each([['limit=101'], ['limit=abc'], ['limit=0'], ['page=0'], ['page=abc']])(
      'rejects ?%s with 400',
      async (query) => {
        await get(`/game-history/me?${query}`).expect(400);
        expect(mocks.gameHistoryService.findByUserId).not.toHaveBeenCalled();
      },
    );

    it('passes page and limit as numbers', async () => {
      await get('/game-history/me?page=2&limit=100').expect(200);
      expect(mocks.gameHistoryService.findByUserId).toHaveBeenCalledWith(
        users.admin.id,
        expect.objectContaining({ page: 2, limit: 100 }),
      );
    });
  });

  it('GET /users/leaderboard rejects an unknown sort field with 400', () =>
    get('/users/leaderboard?sort=passwordHash').expect(400));
});
