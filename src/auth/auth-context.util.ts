import { ExecutionContext } from '@nestjs/common';
import type { Role } from './roles/role.enum';

/**
 * What a WebSocket gateway stores on `client.data.user` once the handshake
 * token is verified (see GameGateway and RealtimeGateway). Built from the JWT
 * payload, so it holds only the claims the token carries, not a full `User`.
 */
export interface SocketUser {
  id: string;
  username?: string;
  role?: Role;
}

/**
 * The authenticated user for any execution context (#362):
 *
 * - `http`: `request.user`, set by JwtAuthGuard / passport;
 * - `ws`: `client.data.user`, set by the gateway when the socket connected;
 * - anything else (scheduled jobs, RPC): undefined.
 *
 * Calling `switchToHttp()` in a WebSocket handler returns the socket, whose
 * `headers` and `user` are undefined, which is why guards and decorators must
 * go through this instead.
 */
export function getAuthUser<T = SocketUser>(
  context: ExecutionContext,
): T | undefined {
  switch (context.getType()) {
    case 'http':
      return context.switchToHttp().getRequest<{ user?: T }>().user;
    case 'ws':
      return context.switchToWs().getClient<{ data?: { user?: T } }>().data
        ?.user;
    default:
      return undefined;
  }
}
