import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { SocketUser } from './auth-context.util';
import { authenticateSocket } from './socket-auth.util';

export const USER_SESSIONS_REVOKED_EVENT = 'user.sessions_revoked';

export interface UserSessionsRevokedPayload {
  userId: string;
}

@Injectable()
export class SocketAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  authenticateSocket(client: Socket): Promise<SocketUser> {
    return authenticateSocket(client, this.jwtService, this.configService);
  }
}
