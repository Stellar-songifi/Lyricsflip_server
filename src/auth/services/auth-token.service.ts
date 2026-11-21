import { runtimeEnv } from '../../config/runtime-env';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../../users/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/** Shared by every login flow and by JwtStrategy, so clients see one message. */
export const INACTIVE_USER_MESSAGE = 'User is inactive';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: Partial<User>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenContext {
  userAgent?: string;
  ip?: string;
  deviceName?: string;
}

/**
 * Issues the access token for every sign-in flow (password signup/login and
 * SEP-10 wallet login), so tokens and the returned user are always built the
 * same way.
 */
@Injectable()
export class AuthTokenService {
  private readonly refreshExpiresIn =
    runtimeEnv().JWT_REFRESH_EXPIRES_IN ?? '7d';

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Rejects a deactivated account. Call before issuing a token so a
   * deactivated user is refused at login rather than on their next request.
   */
  assertActive(user: Pick<User, 'isActive'>): void {
    if (!user.isActive) {
      throw new UnauthorizedException(INACTIVE_USER_MESSAGE);
    }
  }

  /**
   * Builds the JWT payload for a user. Every issuance flow goes through this
   * so `tokenVersion` is always signed; JwtStrategy compares it against the
   * stored value to revoke tokens issued before a password change.
   */
  buildJwtPayload(user: User): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    };
  }

  issueToken(user: User): AuthResult {
    const payload = this.buildJwtPayload(user);

    // The caller's own account, minus the hash (which the password flows
    // load explicitly).
    const userWithoutPassword: Partial<User> = { ...user };
    delete userWithoutPassword.passwordHash;

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        expiresIn: this.refreshExpiresIn,
      }),
      user: userWithoutPassword,
    };
  }

  issueTokenPair(user: User, _context?: RefreshTokenContext): TokenPair {
    const payload = this.buildJwtPayload(user);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        expiresIn: this.refreshExpiresIn,
      }),
    };
  }
}
