import { BadRequestException } from '@nestjs/common';
import {
  I128_MAX,
  I128_MIN,
  STROOPS_PER_TOKEN,
  TOKEN_DECIMALS,
} from './stellar.constants';

/**
 * A token amount in base units ("stroops"), carried as a decimal string.
 *
 * Amounts are never represented as a JavaScript `number`: Soroban stores them
 * as i128, and a 7-decimal token overflows the 2^53 safe-integer range at just
 * ~900 million tokens. Strings cross the DB, the API and the network without
 * losing a single stroop; convert to `bigint` for arithmetic.
 */
export type Stroops = string;

const DISPLAY_AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;
const STROOPS_PATTERN = /^-?\d+$/;

/**
 * Parses a stroop string into a bigint, rejecting anything that is not a
 * whole number inside the i128 range.
 */
export function toBigInt(stroops: Stroops): bigint {
  if (typeof stroops !== 'string' || !STROOPS_PATTERN.test(stroops)) {
    throw new BadRequestException(
      `Invalid stroop amount "${String(stroops)}": expected a whole number as a string`,
    );
  }

  const value = BigInt(stroops);

  if (value > I128_MAX || value < I128_MIN) {
    throw new BadRequestException(
      `Stroop amount "${stroops}" does not fit in the i128 range used by Soroban`,
    );
  }

  return value;
}

/**
 * Converts a human-facing decimal amount ("10", "10.5", "0.0000001") into
 * stroops.
 *
 * The conversion is done on the string itself rather than through a float, so
 * values like "0.1" survive exactly.
 */
export function toStroops(displayAmount: string): Stroops {
  if (typeof displayAmount !== 'string') {
    throw new BadRequestException(
      'Token amounts must be sent as strings to avoid floating-point rounding',
    );
  }

  const trimmed = displayAmount.trim();

  if (!DISPLAY_AMOUNT_PATTERN.test(trimmed)) {
    throw new BadRequestException(
      `Invalid token amount "${displayAmount}": expected a non-negative decimal with at most ${TOKEN_DECIMALS} decimal places`,
    );
  }

  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction.padEnd(TOKEN_DECIMALS, '0');
  const value = BigInt(whole) * STROOPS_PER_TOKEN + BigInt(paddedFraction);

  if (value > I128_MAX) {
    throw new BadRequestException(
      `Token amount "${displayAmount}" exceeds the maximum representable value`,
    );
  }

  return value.toString();
}

/**
 * Converts stroops back into a human-facing decimal string, trimming trailing
 * zeros but always keeping at least one decimal place ("10.0", "0.5").
 */
export function fromStroops(stroops: Stroops): string {
  const value = toBigInt(stroops);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  const whole = magnitude / STROOPS_PER_TOKEN;
  const fraction = (magnitude % STROOPS_PER_TOKEN)
    .toString()
    .padStart(TOKEN_DECIMALS, '0')
    .replace(/0+$/, '');

  return `${negative ? '-' : ''}${whole}.${fraction || '0'}`;
}

/** Adds two stroop amounts. */
export function addStroops(a: Stroops, b: Stroops): Stroops {
  return (toBigInt(a) + toBigInt(b)).toString();
}

/** Subtracts `b` from `a`. */
export function subtractStroops(a: Stroops, b: Stroops): Stroops {
  return (toBigInt(a) - toBigInt(b)).toString();
}

/** Multiplies a stroop amount by a whole-number factor (e.g. two stakes). */
export function multiplyStroops(a: Stroops, factor: number | bigint): Stroops {
  return (toBigInt(a) * BigInt(factor)).toString();
}

/** Returns true when `a` is greater than or equal to `b`. */
export function isAtLeast(a: Stroops, b: Stroops): boolean {
  return toBigInt(a) >= toBigInt(b);
}

/** Returns true when the amount is strictly greater than zero. */
export function isPositive(amount: Stroops): boolean {
  return toBigInt(amount) > 0n;
}

/**
 * Validates a stake amount and returns it normalised (no leading zeros).
 * Throws when the amount is zero, negative or malformed.
 */
export function assertPositiveStroops(
  amount: Stroops,
  field = 'amount',
): Stroops {
  const value = toBigInt(amount);

  if (value <= 0n) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }

  return value.toString();
}
