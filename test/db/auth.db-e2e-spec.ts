import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { MailerService } from '../../src/auth/services/mailer.service';
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

  it('resets a forgotten password, revokes sessions and bumps tokenVersion', async () => {
    await http().post('/auth/signup').send(creds).expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);

    const mailer = app.get(MailerService);
    const sent = jest.spyOn(mailer, 'sendPasswordResetEmail').mockResolvedValue();
    await http().post('/auth/forgot-password').send({ email: creds.email }).expect(200);
    expect(sent).toHaveBeenCalledTimes(1);
    const resetToken = sent.mock.calls[0][1];
    sent.mockRestore();

    const [before] = await dataSource.query('SELECT "tokenVersion" FROM "users" WHERE email = $1', [creds.email]);

    const newPassword = 'Res3t!Passw0rd';
    await http().post('/auth/reset-password').send({ token: resetToken, password: newPassword }).expect(200);

    const [after] = await dataSource.query('SELECT "tokenVersion" FROM "users" WHERE email = $1', [creds.email]);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    // Old refresh token revoked, old password rejected, new one works.
    await http().post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    await http().post('/auth/login').send({ email: creds.email, password: creds.password }).expect(401);
    await http().post('/auth/login').send({ email: creds.email, password: newPassword }).expect(200);

    // Token is single-use.
    await http().post('/auth/reset-password').send({ token: resetToken, password: 'Ano7her!Passw0rd' }).expect(400);
  });
});
