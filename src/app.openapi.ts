import { ErrorCode } from './common/exceptions/domain.exception';
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
 * Shared error response shape. Every operation documents its error responses
 * against this schema so clients can generate a single error type (#527).
 */
export const ERROR_RESPONSE_SCHEMA = 'ErrorResponse';

/**
 * Generic pagination envelope schema name. List endpoints reference this
 * schema so the envelope is described once instead of per route (#527).
 */
export const PAGINATION_ENVELOPE_SCHEMA = 'PaginationEnvelope';

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
  const document = SwaggerModule.createDocument(app, config);
  const components = (document.components ??= {});
  const schemas = (components.schemas ??= {});
  schemas.ErrorCode = { type: 'string', enum: Object.values(ErrorCode) };
  schemas.ErrorResponse = {
    type: 'object',
    required: [
      'code',
      'statusCode',
      'message',
      'error',
      'timestamp',
      'path',
      'method',
    ],
    properties: {
      code: { $ref: '#/components/schemas/ErrorCode' },
      statusCode: { type: 'integer' },
  registerSharedResponseSchemas(document);
  return document;
}

/**
 * Registers the shared error and pagination envelope schemas and backfills
 * any operation whose response lacks a schema, so the exported document never
 * contains an untyped response (#527).
 */
function registerSharedResponseSchemas(document: OpenAPIObject): void {
  document.components = document.components ?? {};
  document.components.schemas = document.components.schemas ?? {};

  document.components.schemas[ERROR_RESPONSE_SCHEMA] = {
    type: 'object',
    required: ['statusCode', 'message'],
    properties: {
      statusCode: { type: 'integer', example: 400 },
      message: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      error: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string' },
      method: { type: 'string' },
      requestId: { type: 'string' },
      details: {},
    },
  };
  for (const path of Object.values(document.paths)) {
    for (const operation of [
      path.get,
      path.post,
      path.put,
      path.patch,
      path.delete,
      path.head,
      path.options,
    ]) {
      if (operation)
        operation.responses.default ??= {
          description:
            'Error response. See ErrorCode for the stable machine-readable codes.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        };
    }
  }
  return document;
      error: { type: 'string', example: 'Bad Request' },
    },
  };

  document.components.schemas[PAGINATION_ENVELOPE_SCHEMA] = {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      meta: {
        type: 'object',
        required: ['total', 'page', 'limit'],
        properties: {
          total: { type: 'integer', example: 0 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          totalPages: { type: 'integer', example: 0 },
        },
      },
    },
  };

  const errorRef = { $ref: `#/components/schemas/${ERROR_RESPONSE_SCHEMA}` };

  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) {
        continue;
      }
      const responses = (operation as { responses?: Record<string, unknown> }).responses;
      if (!responses) {
        continue;
      }
      for (const [status, response] of Object.entries(responses)) {
        const res = response as { content?: Record<string, unknown> };
        if (res.content && Object.keys(res.content).length > 0) {
          continue;
        }
        const isError = Number(status) >= 400;
        res.content = {
          'application/json': {
            schema: isError ? errorRef : { type: 'object' },
          },
        };
      }
    }
  }
}
