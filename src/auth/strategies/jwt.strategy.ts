import {
  DomainException,
  ErrorCode,
} from '../../common/exceptions/domain.exception';
import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { User } from '../../users/entities/user.entity';
import { INACTIVE_USER_MESSAGE } from '../services/auth-token.service';
import { jwtSecretForToken } from '../jwt-key.util';

/**
 * Shared user/token validation used by both the HTTP JWT strategy and the
 * WebSocket authentication path so that `isActive` and `tokenVersion` are
 * enforced identically everywhere.
 */
export async function validateUserToken(
  userRepository: Repository<User>,
  payload: JwtPayload,
): Promise<User> {
  const { sub } = payload;
  const user = await userRepository.findOne({ where: { id: sub } });

  if (!user) {
    throw new UnauthorizedException('Token is invalid');
  }
  if (!user.isActive) {
    throw new UnauthorizedException(INACTIVE_USER_MESSAGE);
  }
  // A token minted before the user's tokenVersion was bumped (password
  // change, or a future "log out everywhere") is rejected even though it
  // has not expired yet.
  if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
    throw new DomainException(
      ErrorCode.TOKEN_REVOKED,
      HttpStatus.UNAUTHORIZED,
      'Token has been revoked',
    );
  }

  return user;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not set in environment variables');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (_request, rawJwtToken, done) => {
        try {
          if (typeof rawJwtToken !== 'string') {
            throw new UnauthorizedException('Token is invalid');
          }
          done(
            null,
            jwtSecretForToken(
              rawJwtToken,
              jwtSecret,
              configService.get<string>('JWT_SECRET_PREVIOUS'),
            ),
          );
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)));
        }
      },
      issuer: configService.get<string>('JWT_ISSUER', 'lyricsflip'),
      audience: configService.get<string>('JWT_AUDIENCE', 'lyricsflip-api'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    return validateUserToken(this.userRepository, payload);
  }
}
