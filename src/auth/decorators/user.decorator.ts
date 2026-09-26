import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { User } from '../../users/entities/user.entity';

/**
 * `@GetUser()` injects the authenticated user; `@GetUser('id')` injects only
 * that property of it.
 */
export const GetUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<Request>().user as
      | User
      | undefined;
    return data ? user?.[data] : user;
  },
);
