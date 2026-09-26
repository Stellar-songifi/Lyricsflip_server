import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { helmetOptions } from './common/security/helmet.config';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
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

  // Realtime events fan out through Redis when REDIS_URL is set, so every
  // instance can reach every connected player.
  if (process.env.REDIS_URL) {
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connectToRedis(process.env.REDIS_URL);
    app.useWebSocketAdapter(ioAdapter);
  }

  // Global validation pipe and response serializer (shared with e2e tests)
  configureApp(app);

  // Behind a load balancer, set TRUST_PROXY (e.g. 1 for one hop) so rate
  // limiting sees the real client IP instead of the proxy's.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  }

  app.disable('x-powered-by');
  app.use(helmet(helmetOptions));

  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('LyricFlip API')
    .setDescription('API documentation for LyricFlip backend')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  winstonLogger.log(
    `Application is running on http://localhost:${port}`,
    'Bootstrap',
  );
}
bootstrap();
