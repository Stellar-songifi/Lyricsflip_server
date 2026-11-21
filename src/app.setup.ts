import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { allowedOrigins } from './common/security/cors';

/**
 * Global route prefix.
 *
 * URI versioning is enabled in app.openapi.ts, so Nest appends the version
 * segment after this prefix. Keeping the prefix at `api` (not `api/v1`)
 * yields `/api/v1/...` and avoids a duplicated `/api/v1/v1/...` segment.
 */
export const API_GLOBAL_PREFIX = 'api';

/**
 * Global request validation and response serialization.
 *
 * Shared by main.ts and the e2e tests so tests exercise the same pipeline
 * production does.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  // Applies @Exclude/@Expose on entities, so fields such as
  // User.passwordHash and User.email are stripped from every response.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Explicit body size limits. Requests exceeding these receive 413.
  // Multipart uploads are not handled here; see [R2-27].
  app.use(json({ limit: getBodyLimit('JSON_BODY_LIMIT', '100kb') }));
  app.use(
    urlencoded({
      extended: true,
      limit: getBodyLimit('URLENCODED_BODY_LIMIT', '100kb'),
    }),
  );

  // CORS must be registered before the HTTP adapter starts listening,
  // otherwise the configuration is never applied to the running server.
  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
  });
}

/**
 * Resolves a body limit from the environment, falling back to a default.
 */
export function getBodyLimit(envVar: string, fallback: string): string {
  const value = process.env[envVar]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/** Backwards-compatible parser; app configuration uses the shared helper. */
export function parseAllowedOrigins(frontendUrl?: string): string[] {
  return allowedOrigins(frontendUrl ?? '');
}
