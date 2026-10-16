import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Suppress Nest's default console logger; our Winston instance takes over.
    bufferLogs: true,
  });

  // Get validated application configuration.
  const configService = app.get(ConfigService);
  const winstonLogger = new LoggerService(configService);

  // Register Winston as the app-wide logger (replaces Nest's default).
  app.useLogger(winstonLogger);
  app.flushLogs();

  // Enable NestJS lifecycle shutdown hooks so SIGTERM/SIGINT trigger
  // onApplicationShutdown() on services that implement it.
  app.enableShutdownHooks();

  // Realtime events fan out through Redis when REDIS_URL is set.
  const redisUrl = configService.get<string>('REDIS_URL');

  if (redisUrl) {
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(ioAdapter);
  }

  // Global validation pipe, response serializer, and CORS configuration.
  configureApp(
    app,
    configService.get<string>('NODE_ENV') ?? 'development',
    configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
  );

  // All API routes are served under /api/v1/...
  // Health probe endpoints and Swagger remain outside the versioned prefix.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health/live',
      'health/ready',
      '',
      'stellar/health',
    ],
  });

  // URI-based versioning (/api/v1/...) with version 1 as the default.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Configure trusted proxy hops.
  const trustProxy = configService.get<string | number>('TRUST_PROXY');

  if (
    trustProxy !== undefined &&
    trustProxy !== null &&
    trustProxy !== ''
  ) {
    const hops = Number(trustProxy);

    app.set(
      'trust proxy',
      Number.isNaN(hops) ? trustProxy : hops,
    );
  }

  app.disable('x-powered-by');
  app.use(helmet(helmetOptions));

  // Swagger configuration — served at /api/docs.
  const swaggerConfig = new DocumentBuilder()
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

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // Read the validated port and host configuration.
  const port = configService.get<number>('PORT') ?? 3000;
  const host = configService.get<string>('HOST') ?? 'localhost';

  await app.listen(port, host);

  winstonLogger.log(
    `Application is running on http://${host}:${port}`,
    'Bootstrap',
  );
}

bootstrap();
