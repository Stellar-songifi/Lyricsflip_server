import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { createDbApp, truncateAll } from './db-app';

describe('Auth flow (real Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, dataSource } = await createDbApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => truncateAll(dataSource));

  const http = () => request(app.getHttpServer());
  const creds = { username: 'e2e_user', email: 'e2e@example.com', password: 'Str0ng!Passw0rd' };

  it('signs up, logs in, rotates refresh tokens, logs out, changes password', async () => {
    await http().post('/auth/signup').send(creds).expect(201);

    const login = await http()
      .post('/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    const { accessToken, refreshToken } = login.body;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    // Rotation: the new pair works, the old refresh token is rejected.
    const rotated = await http().post('/auth/refresh').send({ refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);

    // Logout revokes the refresh token.
    await http().post('/auth/logout').send({ refreshToken: rotated.body.refreshToken }).expect(200);
    await http().post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);

    // Change password, then the old one stops working.
    const newPassword = 'An0ther!Passw0rd';
    await http()
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: creds.password, newPassword })
      .expect(200);
    await http().post('/auth/login').send({ email: creds.email, password: creds.password }).expect(401);
    await http().post('/auth/login').send({ email: creds.email, password: newPassword }).expect(200);
  });
});
