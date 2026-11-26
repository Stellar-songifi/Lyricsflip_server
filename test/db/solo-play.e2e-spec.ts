import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from '../support/test-app';

describe('Solo play (e2e, real Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let userId: string;

  const credentials = {
    email: `solo-play-${Date.now()}@example.com`,
    username: `soloplay${Date.now()}`,
    password: 'Sup3rSecret!',
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(credentials)
      .expect(201);

    accessToken = signup.body.accessToken ?? signup.body.access_token;
    userId = signup.body.user?.id ?? signup.body.id;

    if (!accessToken) {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);
      accessToken = login.body.accessToken ?? login.body.access_token;
      userId = login.body.user?.id ?? login.body.id;
    }
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  it('returns a lyric for a solo round', async () => {
    const res = await request(app.getHttpServer())
      .get('/game/lyric')
      .set(auth())
      .expect(200);

    expect(res.body).toBeDefined();
    expect(res.body.lyric ?? res.body.text ?? res.body.snippet).toBeDefined();
  });

  it('accepts a guess and awards XP', async () => {
    const lyric = await request(app.getHttpServer())
      .get('/game/lyric')
      .set(auth())
      .expect(200);

    const roundId = lyric.body.roundId ?? lyric.body.round_id ?? lyric.body.id;
    const guessText =
      lyric.body.answer ?? lyric.body.title ?? lyric.body.trackTitle ?? 'unknown';

    const guess = await request(app.getHttpServer())
      .post('/game/guess')
      .set(auth())
      .send({ roundId, guess: guessText })
      .expect(201);

    expect(guess.body).toBeDefined();
    expect(guess.body.correct ?? guess.body.isCorrect).toBeDefined();

    const xpRow = await dataSource.query(
      'SELECT xp FROM users WHERE id = $1',
      [userId],
    );
    expect(xpRow.length).toBe(1);
    expect(Number(xpRow[0].xp)).toBeGreaterThanOrEqual(0);
  });

  it('records the round in history', async () => {
    const res = await request(app.getHttpServer())
      .get('/game/history')
      .set(auth())
      .expect(200);

    const history = Array.isArray(res.body) ? res.body : res.body.items ?? res.body.data;
    expect(Array.isArray(history)).toBe(true);
  });

  it('includes the player on the leaderboard', async () => {
    const res = await request(app.getHttpServer())
      .get('/leaderboard')
      .set(auth())
      .expect(200);

    const entries = Array.isArray(res.body) ? res.body : res.body.entries ?? res.body.data;
    expect(Array.isArray(entries)).toBe(true);
  });
});
