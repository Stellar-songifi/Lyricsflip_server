import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import {
  API_PREFIX,
  buildOpenApiDocument,
  configureApiRouting,
} from './app.openapi';

@Controller('auth')
class FakeAuthController {
  @Post('login')
  login() {
    return { ok: true };
  }
}

@Controller('health')
class FakeHealthController {
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}

/**
 * #363: the exported OpenAPI document listed `/auth/login` while the API
 * served it under the global prefix. These tests build the document the way
 * main.ts and scripts/export-openapi.ts do, then call every path it lists on
 * the same app, so a document whose paths do not match real routing fails.
 */
describe('OpenAPI document', () => {
  let app: INestApplication;
  let paths: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FakeAuthController, FakeHealthController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiRouting(app);
    paths = Object.keys(buildOpenApiDocument(app).paths);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('puts API routes under the global prefix', () => {
    const login = paths.find((path) => path.endsWith('/auth/login'));
    expect(login).toBeDefined();
    expect(login!.startsWith(`/${API_PREFIX}/`)).toBe(true);
  });

  it('keeps the health probes outside the global prefix', () => {
    const live = paths.find((path) => path.endsWith('/health/live'));
    expect(live).toBeDefined();
    expect(live!.startsWith(`/${API_PREFIX}/`)).toBe(false);
  });

  it('lists only paths the app actually serves', async () => {
    const login = paths.find((path) => path.endsWith('/auth/login'))!;
    const live = paths.find((path) => path.endsWith('/health/live'))!;

    await request(app.getHttpServer()).post(login).expect(201);
    await request(app.getHttpServer()).get(live).expect(200);
  });

  it('declares the bearer scheme used by the Authorize button', () => {
    const document = buildOpenApiDocument(app);
    expect(document.components?.securitySchemes?.['JWT-auth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
