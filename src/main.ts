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

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST ?? 'localhost';
  await app.listen(port, host);

  winstonLogger.log(
    `Application is running on http://${host}:${port}`,
    'Bootstrap',
  );
}
bootstrap();
