import {
  INestApplication,
  Logger,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket as ServerSocket } from 'socket.io';
import { io, Socket } from 'socket.io-client';
import { GetUser } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/roles/role.enum';
import { Roles } from '../auth/roles/roles.decorator';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { AppThrottlerGuard } from './throttler/app-throttler.guard';

/**
 * A gateway behind the app's HTTP-era enhancers (#362). Before the fix each
 * of them called switchToHttp() and read `headers` off the socket, so every
 * message failed with a TypeError that hid the real error.
 *
 * The real gateways verify a JWT in handleConnection; this one trusts the
 * handshake so the test can pick the user.
 */
@WebSocketGateway({ namespace: 'enhancers' })
@UseGuards(JwtAuthGuard, RolesGuard, AppThrottlerGuard)
@UseInterceptors(LoggingInterceptor)
@UseFilters(AllExceptionsFilter)
class EnhancedGateway implements OnGatewayConnection {
  handleConnection(client: ServerSocket) {
    const { id, role } = client.handshake.auth as { id?: string; role?: Role };
    if (id) client.data.user = { id, username: `user-${id}`, role };
  }

  @SubscribeMessage('whoami')
  whoami(@GetUser('id') id: string) {
    return id;
  }

  @Roles(Role.Admin)
  @SubscribeMessage('adminOnly')
  adminOnly() {
    return 'ok';
  }

  @SubscribeMessage('boom')
  boom() {
    throw new Error('kaboom: the real error');
  }
}

interface ErrorEnvelope {
  event: 'error';
  data: { code: number; message: string };
}

describe('Enhancers in a WebSocket gateway (#362)', () => {
  let app: INestApplication;
  let url: string;
  let errorLog: jest.SpyInstance;
  const sockets: Socket[] = [];

  const connect = async (auth: Record<string, unknown>): Promise<Socket> => {
    const socket = io(`${url}/enhancers`, {
      auth,
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  };

  const nextError = (socket: Socket) =>
    new Promise<ErrorEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no error event')), 2000);
      socket.once('error', (envelope: ErrorEnvelope) => {
        clearTimeout(timer);
        resolve(envelope);
      });
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
      providers: [EnhancedGateway],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error');
  });

  afterEach(() => {
    const logged = errorLog.mock.calls.map((args) =>
      args.map((arg: unknown) => String(arg)).join(' '),
    );
    // No enhancer may fail with its own TypeError (e.g. reading `headers`
    // of a socket) and mask what the handler did.
    expect(logged.filter((line) => line.includes('TypeError'))).toEqual([]);
    errorLog.mockRestore();
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app.close();
  });

  it('@GetUser reads the socket user', async () => {
    const socket = await connect({ id: 'u1', role: Role.User });
    await expect(socket.emitWithAck('whoami', {})).resolves.toBe('u1');
  });

  it('@Roles lets an admin through', async () => {
    const socket = await connect({ id: 'a1', role: Role.Admin });
    await expect(socket.emitWithAck('adminOnly', {})).resolves.toBe('ok');
  });

  it('@Roles rejects a regular user with 403', async () => {
    const socket = await connect({ id: 'u2', role: Role.User });
    const error = nextError(socket);
    socket.emit('adminOnly', {});
    await expect(error).resolves.toMatchObject({
      event: 'error',
      data: { code: 403 },
    });
  });

  it('rejects a socket without a user with 401', async () => {
    const socket = await connect({});
    const error = nextError(socket);
    socket.emit('whoami', {});
    await expect(error).resolves.toMatchObject({ data: { code: 401 } });
  });

  it('reports a handler error with its real message', async () => {
    const socket = await connect({ id: 'u3', role: Role.User });
    const error = nextError(socket);
    socket.emit('boom', {});

    await expect(error).resolves.toMatchObject({ data: { code: 500 } });
    const logged = errorLog.mock.calls.map((args) => String(args[0]));
    expect(logged.some((line) => line.includes('kaboom: the real error'))).toBe(
      true,
    );
  });
});
