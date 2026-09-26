import * as express from 'express';
import helmet from 'helmet';
import * as request from 'supertest';
import { helmetOptions } from '../src/common/security/helmet.config';

describe('Security headers', () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet(helmetOptions));
  app.get('/', (_req, res) => res.send('ok'));

  it('sets key security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
