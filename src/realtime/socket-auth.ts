import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketAuthenticator } from '../auth/socket-authenticator';

/**
 * Shared Socket.IO wiring used by every gateway (GameGateway, RealtimeGateway).
 *
 * Authentication, CORS and the connection limits live here once so a security
 * fix only has to be made in a single place (R3-95).
 */

/**
 * CORS callback shared by every namespace: same allow-list as the HTTP API
 * (FRONTEND_URL), evaluated per request.
 */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const allowed = process.env.FRONTEND_URL || 'http://localhost:3000';
  callback(null, !origin || origin === allowed);
}

/**
 * Registers the authentication middleware once on the adapter so it runs for
 * every namespace. It sets `socket.data.user` (and `socket.data.userId`) or
 * rejects the handshake with an `Unauthorized` error.
 */
export function registerSocketAuth(
  server: Server,
  authenticator: SocketAuthenticator,
  logger: Logger = new Logger('SocketAuth'),
): void {
  server.use(async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const user = await authenticator.authenticateSocket(socket);
      socket.data.userId = user.id;
      // Read by @GetUser, RolesGuard and JwtAuthGuard in handlers (#362).
      socket.data.user = user;
      next();
    } catch {
      logger.warn(`Rejected unauthenticated connection: ${socket.id}`);
      next(new Error('Unauthorized'));
    }
  });
}
