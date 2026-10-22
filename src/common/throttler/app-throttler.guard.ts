import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Socket } from 'socket.io';

/** A socket has no HTTP response to put rate-limit headers on. */
const NO_HEADERS = {
  header: () => NO_HEADERS,
  setHeader: () => undefined,
};

/**
 * Keys limits by authenticated user ID when available, otherwise by IP.
 * Behind a load balancer set TRUST_PROXY so `req.ip` is the real client.
 *
 * WebSocket messages are limited too, keyed the same way: by the user the
 * gateway stored on `client.data.user`, or the handshake address. Any other
 * context is passed through (#362).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType();
    if (type !== 'http' && type !== 'ws') {
      return true;
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  }

  protected getRequestResponse(context: ExecutionContext): {
    req: Record<string, any>;
    res: Record<string, any>;
  } {
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      const data = client.data as { user?: { id?: string } } | undefined;
      return {
        req: {
          ip: client.handshake?.address,
          headers: client.handshake?.headers ?? {},
          user: data?.user,
        },
        res: NO_HEADERS,
      };
    }
    return super.getRequestResponse(context);
  }
}
