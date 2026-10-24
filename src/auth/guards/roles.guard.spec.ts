import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../roles/role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createExecutionContext = (user?: { role?: Role }) => {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as import('@nestjs/common').ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no roles metadata is set', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined as any);

    const can = guard.canActivate(createExecutionContext({ role: Role.User }));
    expect(can).toBe(true);
  });

  it('allows when user has required role', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.Admin]);

    const can = guard.canActivate(createExecutionContext({ role: Role.Admin }));
    expect(can).toBe(true);
  });

  it('denies when user is missing', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.Admin]);

    expect(() => guard.canActivate(createExecutionContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when user lacks required role', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.Admin]);

    expect(() =>
      guard.canActivate(createExecutionContext({ role: Role.User })),
    ).toThrow(ForbiddenException);
  });

  it('supports multiple allowed roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.Admin, Role.User]);

    const can = guard.canActivate(createExecutionContext({ role: Role.User }));
    expect(can).toBe(true);
  });

  describe('in a WebSocket handler (#362)', () => {
    const wsContext = (user?: { role?: Role }) =>
      ({
        getType: () => 'ws',
        switchToHttp: () => {
          throw new Error('switchToHttp must not be used for a socket');
        },
        switchToWs: () => ({
          getClient: () => ({ id: 'socket-1', data: { user } }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      }) as unknown as import('@nestjs/common').ExecutionContext;

    it('allows a socket whose user has the role', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce([Role.Admin]);
      expect(guard.canActivate(wsContext({ role: Role.Admin }))).toBe(true);
    });

    it('denies a socket whose user lacks the role', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce([Role.Admin]);
      expect(() => guard.canActivate(wsContext({ role: Role.User }))).toThrow(
        ForbiddenException,
      );
    });

    it('denies a socket without a user', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce([Role.Admin]);
      expect(() => guard.canActivate(wsContext())).toThrow(ForbiddenException);
    });
  });
});
