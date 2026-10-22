import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Every API route is served under this prefix. */
export const API_PREFIX = 'api/v1';

/**
 * Routes kept outside {@link API_PREFIX}: the liveness and readiness probes
 * (so k8s and load balancers never need reconfiguring when the API version
 * changes), the root redirect and the public Stellar health probe.
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
