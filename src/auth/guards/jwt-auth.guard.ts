import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getAuthUser } from '../auth-context.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Lets routes marked with `@Public()` through untouched.
   *
   * The handler is checked before the class so a public endpoint on an
   * otherwise-guarded controller behaves as written.
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    switch (context.getType()) {
      case 'http':
        return super.canActivate(context);
      case 'ws':
        // A socket is authenticated once, when it connects: the gateway
        // verifies the handshake token and stores client.data.user. Passport
        // reads request headers, which a socket does not have (#362).
        if (!getAuthUser(context)) {
          throw new UnauthorizedException('Unauthorized');
        }
        return true;
      default:
        // No other transport carries a token to check.
        return true;
    }
  }
}
