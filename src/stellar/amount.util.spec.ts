import { BadRequestException } from '@nestjs/common';
import {
  addStroops,
  assertPositiveStroops,
  fromStroops,
  isAtLeast,
  isPositive,
  multiplyStroops,
  subtractStroops,
  toBigInt,
  toStroops,
} from './amount.util';
import { I128_MAX, I128_MIN, STROOPS_PER_TOKEN } from './stellar.constants';

describe('amount.util', () => {
  describe('toStroops', () => {
    it('scales whole and fractional token amounts by 10^7', () => {
      expect(toStroops('1')).toBe('10000000');
      expect(toStroops('10.5')).toBe('105000000');
      expect(toStroops('0.0000001')).toBe('1');
      expect(toStroops('0')).toBe('0');
    });

    it('converts decimals exactly, without floating-point drift', () => {
      // 0.1 + 0.2 !== 0.3 in binary floating point. Doing the conversion on the
      // string is the whole reason this helper exists.
      expect(addStroops(toStroops('0.1'), toStroops('0.2'))).toBe(
        toStroops('0.3'),
      );
      expect(toStroops('0.7')).toBe('7000000');
    });

    it('keeps precision far beyond the 2^53 safe-integer range', () => {
      // ~900 million tokens is where a 7-decimal amount stops fitting in a
      // double, so this value would lose stroops if it ever became a number.
      const stroops = toStroops('9007199254.7407407');
      expect(stroops).toBe('90071992547407407');
      // Round-tripping through a double loses the final stroop:
      // ...407 comes back as ...410.
      expect(String(Number(stroops))).toBe('90071992547407410');
      expect(fromStroops(stroops)).toBe('9007199254.7407407');
    });

    it('trims surrounding whitespace', () => {
      expect(toStroops('  2.5  ')).toBe('25000000');
    });

    it('rejects more than seven decimal places rather than truncating', () => {
      expect(() => toStroops('0.00000001')).toThrow(BadRequestException);
    });

    it('rejects negatives, blanks and non-numeric text', () => {
      for (const bad of ['-1', '', 'abc', '1.2.3', '1e7', '.5', '+1']) {
        expect(() => toStroops(bad)).toThrow(BadRequestException);
      }
    });

    it('rejects numbers, so callers cannot smuggle a float in', () => {
      expect(() => toStroops(10.5 as unknown as string)).toThrow(
        BadRequestException,
      );
    });

    it('rejects an amount too large to represent as i128', () => {
      const overflowing = (I128_MAX / STROOPS_PER_TOKEN + 1n).toString();
      expect(() => toStroops(overflowing)).toThrow(BadRequestException);
    });
  });

  describe('fromStroops', () => {
    it('renders stroops as a decimal with at least one place', () => {
      expect(fromStroops('10000000')).toBe('1.0');
      expect(fromStroops('105000000')).toBe('10.5');
      expect(fromStroops('1')).toBe('0.0000001');
      expect(fromStroops('0')).toBe('0.0');
    });

    it('keeps the sign of a negative amount on the whole number', () => {
      expect(fromStroops('-105000000')).toBe('-10.5');
      expect(fromStroops('-1')).toBe('-0.0000001');
    });

    it('round-trips every amount toStroops accepts', () => {
      for (const display of ['1.0', '10.5', '0.0000001', '0.0', '123.456']) {
        expect(fromStroops(toStroops(display))).toBe(display);
      }
    });
  });

  describe('toBigInt', () => {
    it('accepts whole numbers at both i128 bounds', () => {
      expect(toBigInt(I128_MAX.toString())).toBe(I128_MAX);
      expect(toBigInt(I128_MIN.toString())).toBe(I128_MIN);
    });

    it('rejects amounts outside the i128 range Soroban stores', () => {
      expect(() => toBigInt((I128_MAX + 1n).toString())).toThrow(
        BadRequestException,
      );
      expect(() => toBigInt((I128_MIN - 1n).toString())).toThrow(
        BadRequestException,
      );
    });

    it('rejects decimals and non-strings', () => {
      expect(() => toBigInt('1.5')).toThrow(BadRequestException);
      expect(() => toBigInt(5 as unknown as string)).toThrow(
        BadRequestException,
      );
      expect(() => toBigInt(null as unknown as string)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('arithmetic', () => {
    it('adds, subtracts and multiplies without precision loss', () => {
      expect(addStroops('10000000', '5000000')).toBe('15000000');
      expect(subtractStroops('10000000', '5000000')).toBe('5000000');
      expect(multiplyStroops('10000000', 2)).toBe('20000000');
      expect(multiplyStroops('10000000', 2n)).toBe('20000000');
    });

    it('allows a subtraction to go negative', () => {
      expect(subtractStroops('1', '2')).toBe('-1');
    });

    it('doubles a stake without overflowing a double', () => {
      const stake = toStroops('900000000');
      expect(multiplyStroops(stake, 2)).toBe('18000000000000000');
    });
  });

  describe('comparisons', () => {
    it('treats isAtLeast as inclusive', () => {
      expect(isAtLeast('10', '10')).toBe(true);
      expect(isAtLeast('11', '10')).toBe(true);
      expect(isAtLeast('9', '10')).toBe(false);
    });

    it('compares numerically rather than lexicographically', () => {
      // "9" > "10" as strings; the balance check depends on it not being so.
      expect(isAtLeast('9', '10')).toBe(false);
      expect(isAtLeast('100', '99')).toBe(true);
    });

    it('treats only amounts above zero as positive', () => {
      expect(isPositive('1')).toBe(true);
      expect(isPositive('0')).toBe(false);
      expect(isPositive('-1')).toBe(false);
    });
  });

  describe('assertPositiveStroops', () => {
    it('normalises leading zeros on a valid stake', () => {
      expect(assertPositiveStroops('0010000000')).toBe('10000000');
    });

    it('rejects a zero or negative stake', () => {
      expect(() => assertPositiveStroops('0')).toThrow(BadRequestException);
      expect(() => assertPositiveStroops('-1')).toThrow(BadRequestException);
    });

    it('names the offending field in the message', () => {
      expect(() => assertPositiveStroops('0', 'stake')).toThrow(
        'stake must be greater than zero',
      );
    });
  });
});
