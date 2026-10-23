import './tracing';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { helmetOptions } from './common/security/helmet.config';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { LoggerService } from './common/services/logger.service';
import { configureApp } from './app.setup';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/**
 * Reads a positive integer of milliseconds from the environment, falling back
 * to the documented default when unset or invalid.
 *
 * Defaults:
 * - HTTP_REQUEST_TIMEOUT_MS = 30000 (max time to receive a complete request;
 *   bounds slow-loris style clients)
 * - HTTP_HEADERS_TIMEOUT_MS = 20000 (max time to receive request headers;
 *   must be lower than requestTimeout)
 * - HTTP_KEEP_ALIVE_TIMEOUT_MS = 65000 (idle keep-alive lifetime; kept higher
 *   than the AWS ALB default idle timeout of 60s so the load balancer always
 *   closes the connection first and never reuses a socket the server closed)
 */
function readTimeoutMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (milliseconds), got "${raw}"`);
  }
  return value;
}

/**
 * JSON and urlencoded body size limit. Override with HTTP_BODY_LIMIT
 * (any value accepted by the body-parser `limit` option, e.g. "100kb").
 */
const DEFAULT_BODY_LIMIT = '100kb';

async function bootstrap() {
  // Instantiate the Winston logger before the app so bootstrap messages
  // also go through it.
  const winstonLogger = new LoggerService();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Suppress Nest's default console logger; our Winston instance takes over.
    bufferLogs: true,
  });

  // Register Winston as the app-wide logger (replaces Nest's default).
  app.useLogger(winstonLogger);
  app.flushLogs();

  // Enable NestJS lifecycle shutdown hooks so SIGTERM/SIGINT trigger
  // onApplicationShutdown() on services that implement it (e.g.
  // InFlightSettlementTracker drains in-flight settlements before exit).
  app.enableShutdownHooks();

  // Explicit body parser limits. Requests above these sizes are rejected with
  // 413 before reaching any handler. Multipart uploads are handled separately
  // (see issue 27).
  const bodyLimit = process.env.HTTP_BODY_LIMIT || DEFAULT_BODY_LIMIT;
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // Realtime events fan out through Redis when REDIS_URL is set, so every
  // instance can reach every connected player.
  if (process.env.REDIS_URL) {
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connectToRedis(process.env.REDIS_URL);
    app.useWebSocketAdapter(ioAdapter);
  }

  // Global validation pipe and response serializer (shared with e2e tests)
  configureApp(app);

  // All API routes are served under /api/v1/...
  // Health probe endpoints (/health/live, /health/ready) and the Swagger UI
  // (/api/docs) are intentionally excluded from the versioned prefix so they
  // remain stable across API version changes.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      // Liveness / readiness probes must stay at a fixed path so k8s and load
      // balancers never need reconfiguring when the API version changes.
      'health/live',
      'health/ready',
      // The root redirect and the stellar/health public probe stay accessible
      // without a versioned prefix as well.
      '',
      'stellar/health',
    ],
  });

  // URI-based versioning (/api/v1/...) with version 1 as the default.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Behind a load balancer, set TRUST_PROXY (e.g. 1 for one hop) so rate
  // limiting sees the real client IP instead of the proxy's.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  }

  app.disable('x-powered-by');
  app.use(helmet(helmetOptions));

  // Swagger configuration — served at /api/docs (outside the versioned prefix)
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
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // CORS must be registered before the server starts listening, otherwise the
  // configuration is not applied to the running HTTP adapter. FRONTEND_URL may
  // hold a comma-separated list of allowed origins.
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Server timeouts. Slow clients that trickle headers or bodies are cut off
  // at requestTimeout / headersTimeout. keepAliveTimeout is deliberately set
  // above the load balancer's idle timeout (AWS ALB default 60s) to avoid
  // intermittent 502s from reusing sockets the server has already closed.
  // See docs/DEPLOYMENT.md for the recommended load balancer settings.
  const httpServer = app.getHttpServer();
  const requestTimeout = readTimeoutMs('HTTP_REQUEST_TIMEOUT_MS', 30_000);
  const headersTimeout = readTimeoutMs('HTTP_HEADERS_TIMEOUT_MS', 20_000);
  const keepAliveTimeout = readTimeoutMs('HTTP_KEEP_ALIVE_TIMEOUT_MS', 65_000);
  if (headersTimeout > requestTimeout) {
    throw new Error(
      'HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS',
    );
  }
  httpServer.requestTimeout = requestTimeout;
  httpServer.headersTimeout = headersTimeout;
  httpServer.keepAliveTimeout = keepAliveTimeout;

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST ?? 'localhost';
  await app.listen(port, host);

  winstonLogger.log(
    `Application is running on http://${host}:${port}`,
    'Bootstrap',
  );
}
bootstrap();
