import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { STATUS_CODES } from 'http';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';
import { getRequestId } from '../request-context';

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  method: string;
  requestId?: string;
}

import { WsExceptionFilter } from './ws-exception.filter';

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

  private readonly wsFilter = new WsExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    // Only HTTP has a request and response to format (#362). getType is
    // missing only on hand-built hosts in unit tests, which are HTTP.
    const type = typeof host.getType === 'function' ? host.getType() : 'http';
    if (type === 'ws') {
      this.catchWs(exception, host);
      return;
    }
    if (type !== 'http') {
      this.logNonHttp(exception, type);
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = this.resolveRequestId(request, response);
    const errorResponse = this.formatError(exception, request, requestId);

    this.logError(exception, request, requestId);

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  /**
   * The ID every log line of this request already carries, so the one a
   * client reports from an error body matches the logs (#200, #360). In
   * order: the request context set by RequestIdMiddleware, the response
   * header it set, the incoming header, and only then a new UUID (for
   * errors raised before the middleware ran). Echoed on the response.
   */
  private resolveRequestId(request: Request, response: Response): string {
    const fromHeader = (value: unknown): string | undefined => {
      const first = Array.isArray(value) ? value[0] : value;
      return typeof first === 'string' && first !== '' ? first : undefined;
    };
    const requestId =
      getRequestId() ||
      (typeof response.getHeader === 'function'
        ? fromHeader(response.getHeader('x-request-id'))
        : undefined) ||
      fromHeader(request.headers['x-request-id']) ||
      randomUUID();

    if (!response.headersSent) response.setHeader('x-request-id', requestId);
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
    error: QueryFailedError & {
      code?: string;
      driverError?: { code?: string };
    },
    timestamp: string,
    path: string,
    method: string,
    requestId: string,
  ): ErrorResponse {
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error occurred';

    // TypeORM exposes the driver error either directly on the QueryFailedError
    // or nested under `driverError`, depending on the driver and version.
    const code = error.code ?? error.driverError?.code;

    switch (code) {
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
      case '22P02': // invalid_text_representation (bad UUID/enum text)
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Invalid input syntax';
        break;
      case '22001': // string_data_right_truncation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Value is too long';
        break;
      case '23514': // check_violation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Value violates a constraint';
        break;
      case '40001': // serialization_failure
        statusCode = HttpStatus.CONFLICT;
        message = 'Request conflicted with a concurrent change; please retry';
        break;
      case '40P01': // deadlock_detected
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Temporary database contention; please retry';
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

  /**
   * A WebSocket handler failed: log the real error with the event and socket,
   * then emit the socket error contract (docs/realtime.md) to the client.
   */
  private catchWs(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<{ id?: string }>();
    const name = exception instanceof Error ? exception.name : 'UnknownError';
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const event = this.wsEvent(host);
    const context = {
      transport: 'ws',
      event,
      socketId: client?.id,
      errorName: name,
      errorMessage: message,
    };
    const stack = exception instanceof Error ? exception.stack : undefined;
    if (!this.isProduction && stack) {
      this.logger.error(
        `WS error occurred: ${name} - ${message}`,
        stack,
        context,
      );
    } else {
      this.logger.error(`WS error occurred: ${name} - ${message}`, context);
    }

    this.wsFilter.catch(exception, host);
  }

  /** The @SubscribeMessage event name, when the host exposes the handler. */
  private wsEvent(host: ArgumentsHost): string | undefined {
    const getHandler = (host as { getHandler?: () => unknown }).getHandler;
    const handler =
      typeof getHandler === 'function' ? getHandler.call(host) : undefined;
    if (typeof handler !== 'function') return undefined;
    return Reflect.getMetadata('message', handler) as string | undefined;
  }

  /** Any other context (RPC): there is no response to write, so just log. */
  private logNonHttp(exception: unknown, type: string): void {
    const name = exception instanceof Error ? exception.name : 'UnknownError';
    const message =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`Error occurred (${type}): ${name} - ${message}`, {
      transport: type,
      errorName: name,
      errorMessage: message,
    });
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
    return STATUS_CODES[statusCode] || 'Error';
  }
}
