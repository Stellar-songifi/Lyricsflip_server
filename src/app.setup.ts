import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { json, urlencoded } from 'express';

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
    origin: parseAllowedOrigins(process.env.FRONTEND_URL),
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

/**
 * Parses FRONTEND_URL into a list of allowed origins.
 *
 * Supports a single origin or a comma-separated list, e.g.
 * "https://app.example.com,https://admin.example.com".
 */
export function parseAllowedOrigins(frontendUrl?: string): string[] {
  return (frontendUrl ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
