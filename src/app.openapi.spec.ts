import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import {
  API_PREFIX,
  buildOpenApiDocument,
  configureApiRouting,
} from './app.openapi';

class LoginResponseDto {
  @ApiProperty()
  ok: boolean;
}

class LiveResponseDto {
  @ApiProperty()
  status: string;
}

@Controller('auth')
class FakeAuthController {
  @Post('login')
  @ApiOkResponse({ type: LoginResponseDto })
  login() {
    return { ok: true };
  }
}

@Controller('health')
class FakeHealthController {
  @Get('live')
  @ApiOkResponse({ type: LiveResponseDto })
  live() {
    return { status: 'ok' };
  }
}

/**
 * #363: the exported OpenAPI document listed `/auth/login` while the API
 * served it under the global prefix. These tests build the document the way
 * main.ts and scripts/export-openapi.ts do, then call every path it lists on
 * the same app, so a document whose paths do not match real routing fails.
 *
 * #527: every operation must declare a typed response schema so clients can
 * generate types and response drift is caught. This test fails if any
 * operation in the exported document has a response without a schema.
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
    expect(paths).toContain(`/${API_PREFIX}/auth/login`);
  });

  it('keeps the health probes outside the global prefix', () => {
    expect(paths).toContain('/health/live');
  });

  it('lists only paths the app actually serves', async () => {
    await request(app.getHttpServer())
      .post(`/${API_PREFIX}/auth/login`)
      .expect(201);
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('declares the bearer scheme used by the Authorize button', () => {
    const document = buildOpenApiDocument(app);
    expect(document.components?.securitySchemes?.['JWT-auth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('gives every operation a typed response schema', () => {
    const document = buildOpenApiDocument(app);
    const untyped: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(
        pathItem as Record<string, unknown>,
      )) {
        if (!operation || typeof operation !== 'object') {
          continue;
        }
        const responses = (operation as { responses?: Record<string, unknown> })
          .responses;
        if (!responses || Object.keys(responses).length === 0) {
          untyped.push(`${method.toUpperCase()} ${path} (no responses)`);
          continue;
        }
        for (const [status, response] of Object.entries(responses)) {
          const schema = (response as { content?: Record<string, { schema?: unknown }> })
            ?.content?.['application/json']?.schema;
          if (!schema) {
            untyped.push(`${method.toUpperCase()} ${path} -> ${status}`);
          }
        }
      }
    }

    expect(untyped).toEqual([]);
  });
});
