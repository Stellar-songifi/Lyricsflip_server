import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('CORS', () => {
    const allowedOrigin = 'http://localhost:3000';
    const disallowedOrigin = 'http://evil.example.com';

    beforeEach(() => {
      process.env.FRONTEND_URL = allowedOrigin;
      app.enableCors({
        origin: process.env.FRONTEND_URL.split(',').map((o) => o.trim()),
        credentials: true,
      });
    });

    it('allows preflight requests from an allowed origin', () => {
      return request(app.getHttpServer())
        .options('/')
        .set('Origin', allowedOrigin)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204)
        .expect('Access-Control-Allow-Origin', allowedOrigin);
    });

    it('does not allow requests from a disallowed origin', () => {
      return request(app.getHttpServer())
        .options('/')
        .set('Origin', disallowedOrigin)
        .set('Access-Control-Request-Method', 'GET')
        .expect((res) => {
          expect(res.headers['access-control-allow-origin']).toBeUndefined();
        });
    });
  });
});
