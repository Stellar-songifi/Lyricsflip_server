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
import { XpModule } from './xp-level/xp.module';
import { AuditModule } from './audit/audit.module';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { defaultThrottle } from './common/throttler/throttle.config';
import type { LoggingOptions } from 'typeorm';

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
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (redisUrl) {
          const { default: KeyvRedis } = await import('@keyv/redis');
          return {
            ttl: cacheConfig.defaultTtlMs,
            max: cacheConfig.maxItems,
            stores: [new KeyvRedis(redisUrl)],
          };
        }

        // In-memory fallback (single instance / local dev)
        return {
          ttl: cacheConfig.defaultTtlMs,
          max: cacheConfig.maxItems,
        };
      },
    }),

    // 3. Configure TypeORM using environment variables (#202).
    //
    //    DB_LOGGING            Comma-separated TypeORM log levels or 'all'.
    //                          Default: 'error' in production,
    //                                   'error,warn,slow' in development.
    //    DB_POOL_SIZE          pg connection pool size.  Default: 10.
    //    DB_SLOW_QUERY_THRESHOLD_MS  Slow-query warning threshold (ms).
    //                          Default: 250.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const getRequiredEnv = (key: string): string => {
          const value = configService.get<string>(key);
          if (!value) {
            throw new Error(
              `FATAL ERROR: Environment variable ${key} is not set.`,
            );
          }
          return value;
        };

        const dbHost = getRequiredEnv('DB_HOST');
        const dbPort = parseInt(getRequiredEnv('DB_PORT'), 10);
        const dbUsername = getRequiredEnv('DB_USERNAME');
        const dbPassword = getRequiredEnv('DB_PASSWORD');
        const dbName = getRequiredEnv('DB_NAME');

        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';
        const defaultLogging = isProduction ? 'error' : 'error,warn,slow';
        const loggingRaw = configService.get<string>(
          'DB_LOGGING',
          defaultLogging,
        );

        // Parse DB_LOGGING into the TypeORM LoggingOptions union.
        // Accepted values: 'all', 'false', or a comma-separated list of
        // 'query' | 'error' | 'schema' | 'warn' | 'info' | 'log' | 'slow'
        let logging: LoggingOptions;
        if (loggingRaw === 'all') {
          logging = 'all';
        } else if (loggingRaw === 'false' || loggingRaw === '') {
          logging = false;
        } else {
          logging = loggingRaw
            .split(',')
            .map((s) => s.trim()) as LoggingOptions;
        }

        const poolSize = configService.get<number>('DB_POOL_SIZE', 10);
        const slowQueryThreshold = configService.get<number>(
          'DB_SLOW_QUERY_THRESHOLD_MS',
          250,
        );

        return {
          type: 'postgres',

          // --- Read/Write Splitting Configuration ---
          replication: {
            master: {
              host: dbHost,
              port: dbPort,
              username: dbUsername,
              password: dbPassword,
              database: dbName,
            },
            slaves: [
              {
                host: configService.get<string>('DB_REPLICA_HOST', dbHost),
                port: configService.get<number>('DB_REPLICA_PORT', dbPort),
                username: configService.get<string>(
                  'DB_REPLICA_USERNAME',
                  dbUsername,
                ),
                password: configService.get<string>(
                  'DB_REPLICA_PASSWORD',
                  dbPassword,
                ),
                database: configService.get<string>('DB_REPLICA_NAME', dbName),
              },
            ],
          },

          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: false,

          logging,
          maxQueryExecutionTime: slowQueryThreshold,

          extra: {
            // 'max' is the pg pool option; TypeORM's poolSize is also
            // accepted but extra.max is the canonical pg-pool key.
            max: poolSize,
          },
        };
      },
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
    XpModule,
    AuditModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Reads or generates x-request-id for every request and stores it in
    // AsyncLocalStorage so every Winston log line includes it (#200).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
