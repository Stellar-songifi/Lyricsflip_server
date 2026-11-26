import { HttpStatus } from '@nestjs/common';
import {
  DomainException,
  ErrorCode,
  errorCodeForStatus,
} from './domain.exception';

describe('API error codes', () => {
  it('keeps the published codes stable', () => {
    expect(Object.values(ErrorCode)).toEqual([
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'METHOD_NOT_ALLOWED',
      'CONFLICT',
      'GONE',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'SERVICE_UNAVAILABLE',
      'REQUEST_FAILED',
      'INTERNAL_ERROR',
      'ROUND_ALREADY_GUESSED',
      'ROUND_EXPIRED',
      'ROUND_REQUIRED',
      'INSUFFICIENT_BALANCE',
      'TOKEN_REVOKED',
      'INVITATION_EXPIRED',
      'RATE_LIMITED',
      'VALIDATION_ERROR',
    ]);
  });

  it('preserves domain details and supplies defaults based on status', () => {
    const details = { retry: false };
    const exception = new DomainException(
      ErrorCode.ROUND_EXPIRED,
      HttpStatus.GONE,
      'Round expired',
      details,
    );
    expect(exception.getStatus()).toBe(HttpStatus.GONE);
    expect(exception.getResponse()).toEqual({
      code: 'ROUND_EXPIRED',
      message: 'Round expired',
      details,
    });
    expect(errorCodeForStatus(429)).toBe('RATE_LIMITED');
    expect(errorCodeForStatus(502)).toBe('INTERNAL_ERROR');
  });
});
