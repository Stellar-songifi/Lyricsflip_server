import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * The one username rule (issue R2-90). Signup, the self-service profile
 * update, the admin update and the service-level check all use this, so a
 * user can never rename themselves to something they could not sign up with.
 *
 * Usernames are stored as typed but compared case-insensitively everywhere
 * (`LOWER(username)`), which the `IDX_users_username_lower` unique index
 * supports. "Alice" and "alice" are therefore the same account.
 */
export const USERNAME_RULE = {
  minLength: 3,
  maxLength: 20,
  /** Starts with a letter; then letters, digits and underscores only. */
  pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/,
  description:
    'Username must be 3-20 characters, start with a letter, and contain only letters, numbers and underscores',
} as const;

/**
 * Names that would be confusing or impersonate the service. Compared
 * case-insensitively. `deleted_` is the prefix given to anonymised accounts by
 * UsersService.remove, so nobody may take a name that looks like one.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'administrator',
  'me',
  'root',
  'support',
  'system',
  'moderator',
  'lyricsflip',
];
export const RESERVED_USERNAME_PREFIXES: readonly string[] = ['deleted_'];

export function isReservedUsername(username: string): boolean {
  const lower = username.toLowerCase();
  return (
    RESERVED_USERNAMES.includes(lower) ||
    RESERVED_USERNAME_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/** Why `username` breaks the rule, or null if it is acceptable. */
export function usernameRuleViolation(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RULE.pattern.test(username)) {
    return USERNAME_RULE.description;
  }
  if (isReservedUsername(username)) {
    return 'This username is reserved';
  }
  return null;
}

function IsUsernameConstraint(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isUsername',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => usernameRuleViolation(value) === null,
        defaultMessage: (args: ValidationArguments) =>
          usernameRuleViolation(args.value) ?? USERNAME_RULE.description,
      },
    });
  };
}

/**
 * Trims the value, then enforces USERNAME_RULE and the reserved-name list.
 * Combine with `@IsOptional()` on update DTOs.
 */
export function IsUsername(validationOptions?: ValidationOptions) {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    IsUsernameConstraint(validationOptions),
  );
}
