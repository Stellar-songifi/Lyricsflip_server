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
