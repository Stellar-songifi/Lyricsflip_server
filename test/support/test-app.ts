import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { configureApp } from '../../src/app.setup';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { Role } from '../../src/auth/roles/role.enum';
import { User } from '../../src/users/entities/user.entity';
import { UsersController } from '../../src/users/users.controller';
import { UsersService } from '../../src/users/users.service';
import { AdminController } from '../../src/admin/admin.controller';
import { AdminService } from '../../src/admin/admin.service';
import { GameSessionsController } from '../../src/game-sessions/game-sessions.controller';
import { GameSessionsService } from '../../src/game-sessions/game-sessions.service';
import { GameSession } from '../../src/game-sessions/entities/game-session.entity';
import { GameHistoryController } from '../../src/game-history/game-history.controller';
import { GameHistoryService } from '../../src/game-history/game-history.service';
import { GameHistory } from '../../src/game-history/entities/game-history.entity';
import { RoomsController } from '../../src/rooms/rooms.controller';
import { RoomsService } from '../../src/rooms/rooms.service';
import { Room } from '../../src/rooms/entities/room.entity';
import { RoomUser } from '../../src/rooms/entities/room-user.entity';
import { Lyrics } from '../../src/lyrics/entities/lyrics.entity';
import { Wager } from '../../src/tokens/entities/wager.entity';

/** A bcrypt-looking hash that must never appear in any response. */
export const PASSWORD_HASH =
  '$2b$12$abcdefghijklmnopqrstuuHASHTHATMUSTNEVERLEAK000000000000';

const makeUser = (id: string, username: string, role = Role.User): User =>
  Object.assign(new User(), {
    id,
    username,
    email: `${username}@example.com`,
    name: `${username} real name`,
    passwordHash: PASSWORD_HASH,
    role,
    isActive: true,
    xp: 120,
    level: 2,
    mockBalance: '1000000000',
    stellarAddress: `G${username.toUpperCase()}WALLET`,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  });

export const users = {
  alice: makeUser('11111111-1111-4111-8111-111111111111', 'alice'),
  bob: makeUser('22222222-2222-4222-8222-222222222222', 'bob'),
  admin: makeUser('33333333-3333-4333-8333-333333333333', 'admin', Role.Admin),
};

/** Every email in the fixtures; none should leak outside self/admin views. */
export const EMAILS = Object.values(users).map((u) => u.email);

const lyric = (): Lyrics =>
  Object.assign(new Lyrics(), {
    id: 1,
    content: 'Full lyric',
    lyricSnippet: 'Snippet',
    artist: 'Artist',
    songTitle: 'Title',
    createdBy: users.admin,
  });

const session = (): GameSession =>
  Object.assign(new GameSession(), {
    id: 'session-1',
    score: 500,
    player: users.alice,
    playerTwo: users.bob,
  });

const wager = (): Wager =>
  Object.assign(new Wager(), {
    id: 'wager-1',
    playerA: users.alice,
    playerAId: users.alice.id,
    playerB: users.bob,
    playerBId: users.bob.id,
    winner: users.alice,
  });

const history = (): GameHistory =>
  Object.assign(new GameHistory(), { id: 'history-1', player: users.alice });

/**
 * Stands in for passport: `x-test-user: alice | bob | admin` picks who is
 * signed in; no header means unauthenticated.
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const who = request.headers['x-test-user'] as keyof typeof users;
    if (!who || !users[who]) {
      throw new UnauthorizedException();
    }
    request.user = users[who];
    return true;
  }
}

export const mocks = {
  usersService: {
    findAll: jest.fn(async () => Object.values(users)),
    findOne: jest.fn(async () => users.bob),
    update: jest.fn(async (id: string) =>
      Object.values(users).find((u) => u.id === id),
    ),
    remove: jest.fn(async () => ({ message: 'User deleted successfully' })),
    getLeaderboard: jest.fn(async () => ({ data: [], meta: {} })),
    getUserPreferences: jest.fn(async () => ({})),
    updatePreferences: jest.fn(async () => users.alice),
  },
  adminService: {
    findAllUsers: jest.fn(async () => Object.values(users)),
    findAllLyrics: jest.fn(async () => [lyric()]),
    deleteUser: jest.fn(),
    deleteLyric: jest.fn(),
  },
  gameSessionsService: {
    findAll: jest.fn(async () => [session()]),
    findOne: jest.fn(async () => session()),
    getTopScores: jest.fn(async () => [session()]),
    getRecentGames: jest.fn(async () => [session()]),
    getUserWagers: jest.fn(async () => [wager()]),
    getSessionWager: jest.fn(async () => wager()),
  },
  gameHistoryService: {
    findByUserId: jest.fn(async () => ({ data: [history()], meta: {} })),
  },
  // RoomsService runs for real so its own response shaping is exercised
  roomRepository: {
    findOne: jest.fn(async () =>
      Object.assign(new Room(), {
        id: 'room-1',
        lyric: lyric(),
        roomUsers: [users.alice, users.bob].map((user) =>
          Object.assign(new RoomUser(), {
            id: `member-${user.username}`,
            userId: user.id,
            user,
            hasGuessed: false,
            score: 0,
          }),
        ),
      }),
    ),
  },
};

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      UsersController,
      AdminController,
      GameSessionsController,
      GameHistoryController,
      RoomsController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: UsersService, useValue: mocks.usersService },
      { provide: AdminService, useValue: mocks.adminService },
      { provide: GameSessionsService, useValue: mocks.gameSessionsService },
      { provide: GameHistoryService, useValue: mocks.gameHistoryService },
      RoomsService,
      { provide: getRepositoryToken(Room), useValue: mocks.roomRepository },
      { provide: getRepositoryToken(RoomUser), useValue: {} },
      { provide: getRepositoryToken(Lyrics), useValue: {} },
    ],
  })
    // Controllers also apply JwtAuthGuard directly; the fake has already run
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Fields an embedded (non-self, non-admin) user may carry. */
export const PUBLIC_USER_FIELDS = [
  'id',
  'username',
  'xp',
  'level',
  'levelTitle',
  'createdAt',
];

/**
 * Fails if a body contains a password hash, or — unless `allowPrivate` —
 * any private user field or email.
 */
export function expectNoLeaks(body: unknown, allowPrivate = false): void {
  const json = JSON.stringify(body);
  expect(json).not.toContain('passwordHash');
  expect(json).not.toContain(PASSWORD_HASH);
  if (allowPrivate) return;

  for (const email of EMAILS) {
    expect(json).not.toContain(email);
  }
  // Anything that looks like a user must carry public fields only
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if ('username' in record) {
      for (const key of Object.keys(record)) {
        if (key === 'rank') continue;
        expect(PUBLIC_USER_FIELDS).toContain(key);
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(body);
}
