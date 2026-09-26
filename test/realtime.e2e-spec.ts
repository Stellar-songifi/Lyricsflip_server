import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, Socket } from 'socket.io-client';
import { GameSession } from '../src/game-sessions/entities/game-session.entity';
import { RoomUser } from '../src/rooms/entities/room-user.entity';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RealtimeEvent } from '../src/realtime/realtime.events';

describe('Realtime (e2e)', () => {
  const secret = 'e2e-secret';
  const alice = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const bob = '7a2d3b4c-5e6f-4a71-9b8c-0d1e2f3a4b5c';
  const carol = '8b3e4c5d-6f70-4b82-8c9d-1e2f3a4b5c6d';
  const sessionId = '0b8e7c6d-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

  let app: INestApplication;
  let events: EventEmitter2;
  let jwt: JwtService;
  let url: string;
  const sockets: Socket[] = [];

  const connect = async (userId: string): Promise<Socket> => {
    const token = await jwt.signAsync({ sub: userId }, { secret });
    const socket = io(`${url}/realtime`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connected', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  };

  const next = <T = any>(socket: Socket, event: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event}`)), 2000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), JwtModule.register({})],
      providers: [
        RealtimeGateway,
        { provide: ConfigService, useValue: { get: () => secret } },
        {
          // alice and bob play this session; carol does not.
          provide: getRepositoryToken(GameSession),
          useValue: {
            findOne: async ({ where }: any) =>
              where.id === sessionId
                ? { id: sessionId, player: { id: alice }, playerTwoId: bob }
                : null,
          },
        },
        {
          provide: getRepositoryToken(RoomUser),
          useValue: { findOne: async () => null },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    url = await app.getUrl();
    url = url.replace('[::1]', 'localhost');
    events = app.get(EventEmitter2);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app.close();
  });

  it('rejects a connection without a valid token', async () => {
    const socket = io(`${url}/realtime`, {
      auth: { token: 'nope' },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);

    await new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    expect(socket.connected).toBe(false);
  });

  it('delivers round and result events to both players, and only to them', async () => {
    const [a, b, c] = await Promise.all([
      connect(alice),
      connect(bob),
      connect(carol),
    ]);

    await expect(
      a.emitWithAck('subscribe', { type: 'session', id: sessionId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      b.emitWithAck('subscribe', { type: 'session', id: sessionId }),
    ).resolves.toMatchObject({ ok: true });
    // A non-player cannot listen in.
    await expect(
      c.emitWithAck('subscribe', { type: 'session', id: sessionId }),
    ).resolves.toEqual({
      ok: false,
      error: 'Not found',
    });

    const carolHears = jest.fn();
    c.onAny(carolHears);

    const started = [next(a, 'round.started'), next(b, 'round.started')];
    events.emit(RealtimeEvent.ROUND_STARTED, {
      roundId: 'r1',
      sessionId,
      userId: alice,
      issuedAt: new Date(),
      expiresAt: new Date(),
      answerWindowSeconds: 20,
    });
    const [aStarted, bStarted] = await Promise.all(started);
    expect(aStarted).toMatchObject({ roundId: 'r1', userId: alice });
    expect(bStarted).toMatchObject({ roundId: 'r1', userId: alice });

    const ended = [next(a, 'round.ended'), next(b, 'round.ended')];
    events.emit(RealtimeEvent.ROUND_ENDED, {
      roundId: 'r1',
      sessionId,
      userId: alice,
      isCorrect: true,
      points: 140,
      speedBonus: 40,
      timedOut: false,
      hintsUsed: 0,
    });
    const [aEnded, bEnded] = await Promise.all(ended);
    expect(bEnded).toMatchObject({ isCorrect: true, points: 140 });
    expect(aEnded.points).toBe(140);

    const completed = [
      next(a, 'session.completed'),
      next(b, 'session.completed'),
    ];
    events.emit(RealtimeEvent.SESSION_COMPLETED, {
      sessionId,
      playerId: alice,
      playerTwoId: bob,
      winnerId: alice,
      score: 140,
      playerTwoScore: 90,
    });
    await Promise.all(completed);

    const settled = [next(a, 'wager.settled'), next(b, 'wager.settled')];
    events.emit(RealtimeEvent.WAGER_SETTLED, {
      wagerId: 'w1',
      sessionId,
      playerAId: alice,
      playerBId: bob,
      outcome: 'won',
      winnerId: alice,
      totalPotStroops: '20000000',
    });
    const [settledForAlice] = await Promise.all(settled);
    expect(settledForAlice).toMatchObject({ outcome: 'won', winnerId: alice });

    expect(carolHears).not.toHaveBeenCalled();
  });
});
