import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { RoomsController } from '../src/rooms/rooms.controller';
import { RoomsService } from '../src/rooms/rooms.service';
import { Room } from '../src/rooms/entities/room.entity';
import { RoomUser } from '../src/rooms/entities/room-user.entity';
import { Genre, Lyrics } from '../src/lyrics/entities/lyrics.entity';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GuessType } from '../src/game/dto/guess.dto';

describe('Rooms (e2e)', () => {
  let app: INestApplication<App>;

  // JwtStrategy puts the whole User entity on the request.
  const user = {
    id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    username: 'player',
    email: 'player@example.com',
  };

  const lyric = {
    id: 1,
    lyricSnippet: 'a line from the song',
    artist: 'Artist',
    songTitle: 'Title',
    genre: Genre.Pop,
    decade: '2010',
    isActive: true,
  } as Lyrics;

  const room = {
    id: '0b8e7c6d-5a4f-4e3d-9c2b-1a0f9e8d7c6b',
    name: 'Room',
    lyric,
    lyricId: lyric.id,
    isClosed: false,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  } as Room;

  // In-memory stand-ins for the two tables the rooms flow touches.
  let roomUsers: RoomUser[];

  const roomRepository = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === room.id
          ? {
              ...room,
              roomUsers: roomUsers.map((ru) =>
                ru.userId === user.id ? { ...ru, user } : ru,
              ),
            }
          : null,
      ),
    ),
  };

  const roomUserRepository = {
    findOne: jest.fn(
      ({ where }: { where: { roomId: string; userId: string } }) => {
        const found = roomUsers.find(
          (ru) => ru.roomId === where.roomId && ru.userId === where.userId,
        );
        return Promise.resolve(found ? { ...found, room } : null);
      },
    ),
    create: jest.fn(
      (data: Partial<RoomUser>) =>
        ({ hasGuessed: false, score: 0, ...data }) as RoomUser,
    ),
    save: jest.fn((roomUser: RoomUser) => {
      roomUsers = [
        ...roomUsers.filter((ru) => ru.userId !== roomUser.userId),
        roomUser,
      ];
      return Promise.resolve(roomUser);
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        RoomsService,
        { provide: getRepositoryToken(Room), useValue: roomRepository },
        { provide: getRepositoryToken(RoomUser), useValue: roomUserRepository },
        { provide: getRepositoryToken(Lyrics), useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    roomUsers = [];
    jest.clearAllMocks();
  });

  it('joins a room as the authenticated user id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/rooms/${room.id}/join`)
      .expect(201);

    expect(roomUserRepository.create).toHaveBeenCalledWith({
      roomId: room.id,
      userId: user.id,
    });
    expect(res.body).toMatchObject({ roomId: room.id, userId: user.id });
  });

  it('reads the status of a joined room', async () => {
    await request(app.getHttpServer())
      .post(`/rooms/${room.id}/join`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/rooms/${room.id}/status`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: room.id,
      players: [{ id: user.id, username: 'player', hasGuessed: false }],
    });
    expect(res.body).not.toHaveProperty('lyric.artist');
  });

  it('scores a guess in a joined room', async () => {
    await request(app.getHttpServer())
      .post(`/rooms/${room.id}/join`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/rooms/${room.id}/guess`)
      .send({ guessType: GuessType.ARTIST, guess: 'Artist' })
      .expect(201);

    expect(roomUserRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { roomId: room.id, userId: user.id },
      }),
    );
    expect(res.body).toMatchObject({ roomId: room.id, isCorrect: true });
  });

  it('rejects the status of a room the user has not joined', async () => {
    await request(app.getHttpServer())
      .get(`/rooms/${room.id}/status`)
      .expect(404);
  });
});
