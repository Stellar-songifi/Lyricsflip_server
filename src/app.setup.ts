import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

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

  // CORS must be registered before the HTTP adapter starts listening,
  // otherwise the configuration is never applied to the running server.
  app.enableCors({
    origin: parseAllowedOrigins(process.env.FRONTEND_URL),
    credentials: true,
  });
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
