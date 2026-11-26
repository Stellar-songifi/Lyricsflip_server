import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SocketUser } from './auth-context.util';
import { jwtVerifyOptions } from './jwt-key.util';

interface SocketHandshakeClient {
  handshake: {
    auth?: unknown;
    headers: {
      authorization?: string | string[];
    };
  };
}

interface SocketJwtPayload {
  sub: string;
  username?: string;
  role?: SocketUser['role'];
}

export async function authenticateSocket(
  client: SocketHandshakeClient,
  jwtService: JwtService,
  configService: ConfigService,
): Promise<SocketUser> {
  const handshakeAuth: unknown = client.handshake.auth;
  const authToken =
    handshakeAuth &&
    typeof handshakeAuth === 'object' &&
    'token' in handshakeAuth
      ? handshakeAuth.token
      : undefined;
  const authorization = client.handshake.headers.authorization;
  const bearerToken =
    typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
  const token =
    typeof authToken === 'string' && authToken.length > 0
      ? authToken
      : bearerToken;

  if (!token) {
    throw new UnauthorizedException('Unauthorized');
  }

  const payload = await jwtService.verifyAsync<SocketJwtPayload>(
    token,
    jwtVerifyOptions(token, configService),
  );
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new UnauthorizedException('Token is invalid');
  }

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
  };
}
