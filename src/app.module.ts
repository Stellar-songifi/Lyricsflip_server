import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { LyricsModule } from './lyrics/lyrics.module';
import { AuthModule } from './auth/auth.module';
import { GameSessionsModule } from './game-sessions/game-sessions.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { RoomsModule } from './rooms/rooms.module';
import { cacheConfig } from './config/cache.config';
import { envValidationSchema } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AdminModule } from './admin/admin.module';
import { GameModule } from './game/game.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ChallengesModule } from './challenges/challenges.module';
import { TokensModule } from './tokens/tokens.module';
import { GameHistoryModule } from './game-history/game-history.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RetentionModule } from './retention/retention.module';
import { XpModule } from './xp-level/xp.module';
import { AuditModule } from './audit/audit.module';
import { MetricsModule } from './metrics/metrics.module';
import { AchievementsModule } from './achievements/achievements.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { defaultThrottle } from './common/throttler/throttle.config';
import { buildDataSourceOptions } from './config/database.config';

@Module({
  imports: [
    // 1. Load environment variables from .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRoot([defaultThrottle()]),
    // Drives periodic jobs such as RoomsService.checkAndCloseExpiredRooms.
    ScheduleModule.forRoot(),

    // 2. Configure caching globally (#201).
    //    When REDIS_URL is set, a Keyv/Redis store is used so all instances
    //    share the same cache and invalidation propagates across pods.
    //    When unset (local dev, CI) the default in-memory store is used as a
    //    fallback — no Redis required to run locally.
    //
    //    The in-memory entry cap is configurable via CACHE_MAX_ITEMS (#341).
    //    For Redis, configure `maxmemory-policy allkeys-lru` on the server
    //    (see README) — the `max` option is ignored by Redis stores.
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const maxItems = cacheConfig.getMaxItems(configService);

        if (redisUrl) {
          const { default: KeyvRedis } = await import('@keyv/redis');
          return {
            ttl: cacheConfig.defaultTtlMs,
            max: maxItems,
            stores: [new KeyvRedis(redisUrl)],
          };
        }

        // In-memory fallback (single instance / local dev)
        return {
          ttl: cacheConfig.defaultTtlMs,
          max: maxItems,
        };
      },
    }),

    // 3. Configure TypeORM from the environment. Connection, TLS, pool,
    //    logging and replica settings are built by buildDataSourceOptions
    //    (src/config/database.config.ts), shared with the CLI data source
    //    (typeorm.config.ts) and the seed so all three connect the same way.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildDataSourceOptions((key) => configService.get(key), {
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
        }),
    }),
    UsersModule,
    AuthModule,
    GameSessionsModule,
    LyricsModule,
    RoomsModule,
    AdminModule,
    GameModule,
    RealtimeModule,
    ChallengesModule,
    TokensModule,
    GameHistoryModule,
    NotificationsModule,
    RetentionModule,
    XpModule,
    AuditModule,
    MetricsModule,
    AchievementsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
