import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without a JWT.
 *
 * `JwtAuthGuard` is registered globally, so without this every endpoint —
 * including the ones a user needs in order to obtain a token in the first
 * place, such as login and the SEP-10 wallet challenge — would be unreachable.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
