import { HttpException, HttpStatus } from '@nestjs/common';

export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  CONFLICT = 'CONFLICT',
  GONE = 'GONE',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  REQUEST_FAILED = 'REQUEST_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  ROUND_ALREADY_GUESSED = 'ROUND_ALREADY_GUESSED',
  ROUND_EXPIRED = 'ROUND_EXPIRED',
  ROUND_REQUIRED = 'ROUND_REQUIRED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  INVITATION_EXPIRED = 'INVITATION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

const codesByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.GONE]: ErrorCode.GONE,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

export function errorCodeForStatus(status: number): ErrorCode {
  return (
    codesByStatus[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.REQUEST_FAILED)
  );
}

export class DomainException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    status: HttpStatus,
    message: string | string[],
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
