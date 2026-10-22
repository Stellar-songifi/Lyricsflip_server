import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { GetUser } from './user.decorator';
import type { User } from '../../users/entities/user.entity';

type Factory = (data: unknown, ctx: ExecutionContext) => unknown;

// Nest stores a param decorator's factory in route-args metadata; read it
// back so the decorator can be called the way Nest calls it.
function getFactory(): Factory {
  class TestController {
    handler(@GetUser() user: unknown) {
      return user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'handler',
  ) as Record<string, { factory: Factory }>;
  return Object.values(args)[0].factory;
}

const contextFor = (user?: Partial<User>) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('GetUser', () => {
  const factory = getFactory();
  const user = { id: 'a1b2c3d4-uuid', username: 'player' };

  it('returns the whole user without a key', () => {
    expect(factory(undefined, contextFor(user))).toBe(user);
  });

  it('returns only the requested property with a key', () => {
    expect(factory('id', contextFor(user))).toBe('a1b2c3d4-uuid');
    expect(factory('username', contextFor(user))).toBe('player');
  });

  it('returns undefined when there is no authenticated user', () => {
    expect(factory(undefined, contextFor())).toBeUndefined();
    expect(factory('id', contextFor())).toBeUndefined();
  });
});

describe('GetUser in a WebSocket handler (#362)', () => {
  const factory = getFactory();
  const wsContextFor = (data: Record<string, unknown> | undefined) =>
    ({
      getType: () => 'ws',
      switchToHttp: () => {
        throw new Error('switchToHttp must not be used for a socket');
      },
      switchToWs: () => ({ getClient: () => ({ id: 'socket-1', data }) }),
    }) as unknown as ExecutionContext;

  it('reads client.data.user', () => {
    const user = { id: 'a1b2c3d4-uuid', username: 'player' };
    expect(factory(undefined, wsContextFor({ user }))).toBe(user);
    expect(factory('id', wsContextFor({ user }))).toBe('a1b2c3d4-uuid');
  });

  it('returns undefined for a socket without a user', () => {
    expect(factory('id', wsContextFor({}))).toBeUndefined();
    expect(factory(undefined, wsContextFor(undefined))).toBeUndefined();
  });
});
