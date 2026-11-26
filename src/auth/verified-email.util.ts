import { ForbiddenException } from '@nestjs/common';
import type { User } from '../users/entities/user.entity';

/** Error code returned when an action needs a verified email address. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/** Whether `AUTH_REQUIRE_VERIFIED_EMAIL` gates wagers and the leaderboard. */
export function isVerifiedEmailRequired(): boolean {
  return process.env.AUTH_REQUIRE_VERIFIED_EMAIL === 'true';
}

/**
 * Refuses an unverified user when `AUTH_REQUIRE_VERIFIED_EMAIL` is on.
 * @param action What the user was trying to do, for the error message.
 */
export function assertEmailVerified(
  user: Pick<User, 'emailVerifiedAt'>,
  action: string,
): void {
  if (isVerifiedEmailRequired() && !user.emailVerifiedAt) {
    throw new ForbiddenException({
      statusCode: 403,
      code: EMAIL_NOT_VERIFIED,
      message: `Verify your email address before you ${action}`,
    });
  }
}
