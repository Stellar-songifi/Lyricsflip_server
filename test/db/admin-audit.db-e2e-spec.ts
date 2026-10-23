import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { createDbApp, truncateAll } from './db-app';

describe('Admin audit logs (real Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createDbApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(dataSource);
    const http = request(app.getHttpServer());
    const creds = { username: 'admin_user', email: 'admin@example.com', password: 'Str0ng!Passw0rd' };
    await http.post('/auth/signup').send(creds).expect(201);
    await dataSource.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [creds.email]);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    adminToken = login.body.accessToken;
  });

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  it('rejects invalid query values with 400', async () => {
    await get('/admin/audit-logs?limit=abc').expect(400);
    await get('/admin/audit-logs?offset=-1').expect(400);
    await get('/admin/audit-logs?actorId=not-a-uuid').expect(400);
    await get('/admin/audit-logs?from=yesterday').expect(400);
  });

  it('returns the shared envelope, filters by date range and exports CSV', async () => {
    const res = await get('/admin/audit-logs?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z').expect(200);
    expect(res.body).toEqual({
      data: expect.any(Array),
      meta: { total: expect.any(Number), limit: expect.any(Number), offset: 0, hasNext: expect.any(Boolean) },
    });

    const csv = await get('/admin/audit-logs/export?format=csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('id,timestamp,actorId,actorUsername,action,targetType,targetId,ip,payload');
  });

  it('blocks UPDATE and DELETE on audit_logs at the database level', async () => {
    await dataSource.query(`INSERT INTO audit_logs ("actorId", action) VALUES ('system', 'test.row')`);
    await expect(dataSource.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    await expect(dataSource.query(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(/append-only/);
  });
});
