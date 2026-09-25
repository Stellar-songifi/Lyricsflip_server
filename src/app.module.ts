import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
// import { CommonModule } from './common/common.module';
import { AdminModule } from './admin/admin.module';
import { GameModule } from './game/game.module';
import { TokensModule } from './tokens/tokens.module';
import { GameHistoryModule } from './game-history/game-history.module';
import { NotificationsModule } from './notifications/notifications.module';
import { XpModule } from './xp-level/xp.module';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    // 1. Load environment variables from .env file
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigModule available globally
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    // Drives periodic jobs such as RoomsService.checkAndCloseExpiredRooms.
    ScheduleModule.forRoot(),
    // 2. Configure caching globally
    CacheModule.register({
      isGlobal: true,
      ttl: cacheConfig.lyricsTTL,
      max: cacheConfig.maxItems,
    }),
    // 3. Configure TypeORM using the loaded environment variables
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Helper to ensure required environment variables are set
        const getRequiredEnv = (key: string): string => {
          const value = configService.get<string>(key);
          if (!value) {
            throw new Error(
              `FATAL ERROR: Environment variable ${key} is not set.`,
            );
          }
          return value;
        };

        // Get primary database credentials, ensuring they exist
        const dbHost = getRequiredEnv('DB_HOST');
        const dbPort = parseInt(getRequiredEnv('DB_PORT'), 10);
        const dbUsername = getRequiredEnv('DB_USERNAME');
        const dbPassword = getRequiredEnv('DB_PASSWORD');
        const dbName = getRequiredEnv('DB_NAME');

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

          logging: ['query', 'error'],
          maxQueryExecutionTime: 250,

          extra: {
            poolSize: 10,
          },
        };
      },
    }),
    UsersModule,
    AuthModule,
    GameSessionsModule,
    LyricsModule,
    // CommonModule,
    RoomsModule,
    AdminModule,
    GameModule,
    TokensModule,
    GameHistoryModule,
    NotificationsModule,
    XpModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
