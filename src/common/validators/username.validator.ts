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

const DEFAULT_DENIED_USERNAME_TERMS = ['asshole', 'bitch', 'fuck', 'shit'];
const LEET_LETTERS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
};

function normalizeUsernameForModeration(username: string): string {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\d/g, (digit) => LEET_LETTERS[digit]);
}

function isDeniedUsername(username: string): boolean {
  const normalized = normalizeUsernameForModeration(username);
  const terms =
    process.env.USERNAME_DENY_LIST?.split(',') ?? DEFAULT_DENIED_USERNAME_TERMS;
  return terms.some((term) => {
    const denied = normalizeUsernameForModeration(term);
    return denied.length > 0 && normalized.includes(denied);
  });
}

/** Why `username` breaks the rule, or null if it is acceptable. */
export function usernameRuleViolation(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RULE.pattern.test(username)) {
    return USERNAME_RULE.description;
  }
  if (isReservedUsername(username)) {
    return 'This username is reserved';
  }
  if (isDeniedUsername(username)) {
    return 'This username is unavailable';
  }
  return null;
}

function IsUsernameConstraint(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object, propertyName) {
    registerDecorator({
      name: 'isUsername',
      target: object.constructor,
      propertyName: String(propertyName),
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
