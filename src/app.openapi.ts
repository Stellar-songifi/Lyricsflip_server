import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Base prefix for every versioned API route. URI versioning appends the
 * version segment after this prefix, so the served paths are
 * `/api/v1/<route>` — the prefix must NOT itself contain the version (#449).
 */
export const API_PREFIX = 'api';

/**
 * Routes kept outside {@link API_PREFIX}: the liveness and readiness probes
 * (so k8s and load balancers never need reconfiguring when the API version
 * changes), the root redirect and the public Stellar health probe. These
 * handlers are also marked `VERSION_NEUTRAL` so no version segment is added.
 */
export const API_PREFIX_EXCLUDE = [
  'health/live',
  'health/ready',
  '',
  'stellar/health',
];

/**
 * Global prefix and URI versioning. Must be applied before the OpenAPI
 * document is built: the document's paths come from this configuration, which
 * is why the old one-line `openapi:export` script, which skipped it, exported
 * `/auth/login` instead of the path the API really serves (#363).
 *
 * The prefix is `api` and URI versioning adds the `v1` segment, giving
 * `/api/v1/...` for versioned routes and `/health/live` etc. for the
 * version-neutral ones (#449).
 */
export function configureApiRouting(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: API_PREFIX_EXCLUDE });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
}

/**
 * The OpenAPI document served at /api/docs and written by
 * `npm run openapi:export`. One definition, so the two cannot drift apart.
 * Call {@link configureApiRouting} on `app` first.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('LyricFlip API')
    .setDescription('API documentation for LyricFlip backend')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
        name: 'Authorization',
      },
      'JWT-auth',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}
