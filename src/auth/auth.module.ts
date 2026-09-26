import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { StellarAuthService } from './services/stellar-auth.service';
import { AuthTokenService } from './services/auth-token.service';
import { User } from 'src/users/entities/user.entity';
import { Wager } from '../tokens/entities/wager.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wager]),
import { RefreshToken } from './entities/refresh-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          // Access tokens are short-lived now that a refresh token exists to
          // renew them; a stolen access token stops working within minutes.
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, StellarAuthService, AuthTokenService, JwtStrategy],
  exports: [JwtStrategy, PassportModule, AuthService, StellarAuthService],
})
export class AuthModule {}
