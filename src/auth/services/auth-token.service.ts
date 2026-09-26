import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../../users/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/** Shared by every login flow and by JwtStrategy, so clients see one message. */
export const INACTIVE_USER_MESSAGE = 'User is inactive';

export interface AuthResult {
  accessToken: string;
  user: Partial<User>;
}

/**
 * Issues the access token for every sign-in flow (password signup/login and
 * SEP-10 wallet login), so tokens and the returned user are always built the
 * same way.
 */
@Injectable()
export class AuthTokenService {
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

  issueToken(user: User): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    // The caller's own account, minus the hash (which the password flows
    // load explicitly).
    const userWithoutPassword: Partial<User> = { ...user };
    delete userWithoutPassword.passwordHash;

    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
  }
}
