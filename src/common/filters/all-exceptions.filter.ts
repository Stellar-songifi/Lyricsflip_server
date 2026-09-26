import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  method: string;
  requestId?: string;
}

/**
 * Global exception filter, replacing `ErrorInterceptor`.
 *
 * Interceptors only see errors thrown from inside a handler; they never see
 * errors thrown by guards or pipes, which is why `JwtAuthGuard`, `RolesGuard`
 * and the global `ValidationPipe` used to produce a different response shape
 * than everything else. A `@Catch()` filter sees all of them, so every error
 * - guard, pipe or handler - now shares this one `ErrorResponse` shape.
 *
 * Wrapping an `HttpException` in a new one (as `ErrorInterceptor` did) also
 * threw away the original `cause`, which made stack traces useless for
 * anything but the outermost wrapper. This filter never rethrows: it builds
 * the `ErrorResponse` body and writes it directly with `response.json()`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = this.resolveRequestId(request, response);
    const errorResponse = this.formatError(exception, request, requestId);

    this.logError(exception, request, requestId);

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  /**
   * Reuses an incoming `x-request-id` if the caller (or a proxy) supplied
   * one, otherwise generates one and echoes it back on the response so a
   * client can always correlate a failed request with a log line, even on
   * its first call. See issue #200.
   */
  private resolveRequestId(request: Request, response: Response): string {
    const incoming = request.headers['x-request-id'];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

    response.setHeader('x-request-id', requestId);
    return requestId;
  }

  private formatError(
    exception: unknown,
    request: Request,
    requestId: string,
  ): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;
    const method = request.method;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const statusCode = exception.getStatus();
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message as
              | string
              | string[]) ?? exception.message;

      return {
        statusCode,
        message,
        error: this.getErrorName(statusCode),
        timestamp,
        path,
        method,
        requestId,
      };
    }

    if (exception instanceof QueryFailedError) {
      return this.handleDatabaseError(exception, timestamp, path, method, requestId);
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.isProduction ? 'Internal server error' : message,
      error: 'Internal Server Error',
      timestamp,
      path,
      method,
      requestId,
    };
  }

  /**
   * Maps a handful of common TypeORM/Postgres error codes to a client-safe
   * status and message. In production the raw driver message (which can
   * include table and constraint names) is never returned.
   */
  private handleDatabaseError(
    error: QueryFailedError & { code?: string },
    timestamp: string,
    path: string,
    method: string,
    requestId: string,
  ): ErrorResponse {
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error occurred';

    switch (error.code) {
      case '23505': // unique_violation
        statusCode = HttpStatus.CONFLICT;
        message = 'Resource already exists';
        break;
      case '23503': // foreign_key_violation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Referenced resource does not exist';
        break;
      case '23502': // not_null_violation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Required field is missing';
        break;
      default:
        break;
    }

    return {
      statusCode,
      message: this.isProduction ? message : error.message,
      error: this.getErrorName(statusCode),
      timestamp,
      path,
      method,
      requestId,
    };
  }

  private logError(exception: unknown, request: Request, requestId: string): void {
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';
    const name = exception instanceof Error ? exception.name : 'UnknownError';
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    const context = {
      method,
      url,
      ip,
      userAgent,
      requestId,
      errorName: name,
      errorMessage: message,
    };

    if (!this.isProduction && stack) {
      this.logger.error(`Error occurred: ${name} - ${message}`, stack, context);
    } else {
      this.logger.error(`Error occurred: ${name} - ${message}`, context);
    }
  }

  private getErrorName(statusCode: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };

    return errorNames[statusCode] || 'Error';
  }
}
