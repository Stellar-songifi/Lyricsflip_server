import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { helmetOptions } from './common/security/helmet.config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ErrorInterceptor } from './common/interceptors/error.interceptor';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Global validation pipe and response serializer
  configureApp(app);
  // Behind a load balancer, set TRUST_PROXY (e.g. 1 for one hop) so rate
  // limiting sees the real client IP instead of the proxy's.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    (app as NestExpressApplication).set(
      'trust proxy',
      Number.isNaN(hops) ? process.env.TRUST_PROXY : hops,
    );
  }

  app.disable('x-powered-by');
  app.use(helmet(helmetOptions));

  // This is a Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  app.useGlobalInterceptors(new LoggingInterceptor(), new ErrorInterceptor());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('LyricFlip API')
    .setDescription('API documentation for LyricFlip backend')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Logging and Error interceptors are active`);
}
bootstrap();
