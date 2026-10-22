import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../users/entities/user.entity';
import { getAuthUser } from '../auth-context.util';

/**
 * `@GetUser()` injects the authenticated user; `@GetUser('id')` injects only
 * that property of it.
 *
 * In an HTTP handler this is the `User` JwtAuthGuard loaded. In a WebSocket
 * handler it is `client.data.user`, which the gateway builds from the
 * handshake token's claims (`id`, `username`, `role`), not a full `User`
 * (#362).
 */
export const GetUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const user = getAuthUser<User>(ctx);
    return data ? user?.[data] : user;
  },
);
