import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { redact } from '../utils/redact.util';

/** Where @SubscribeMessage stores the event name on a gateway handler. */
const WS_MESSAGE_METADATA = 'message';

/**
 * Logs every HTTP request and WebSocket message.
 *
 * Registered globally, so it checks the context type instead of assuming
 * HTTP (#362): a WebSocket handler's "request" is the socket, which has no
 * `headers` or `url`. Other contexts are passed through untouched.
 *
 * HTTP metrics are not recorded here: an interceptor never sees requests
 * rejected by a guard or pipe, so they are recorded by HttpMetricsMiddleware
 * instead (#361).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    switch (context.getType()) {
      case 'http':
        return this.interceptHttp(context, next);
      case 'ws':
        return this.interceptWs(context, next);
      default:
        return next.handle();
    }
  }

  private interceptWs(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const client = context.switchToWs().getClient<{ id?: string }>();
    const handler = context.getHandler();
    const event =
      (Reflect.getMetadata(WS_MESSAGE_METADATA, handler) as
        | string
        | undefined) ?? handler.name;
    const socketId = client?.id ?? 'unknown';
    const startTime = Date.now();

    this.logger.log(`Incoming WS message: ${event} (socket ${socketId})`);

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `WS message handled: ${event} (socket ${socketId}) - ${Date.now() - startTime}ms`,
          );
        },
        error: (error) => {
          this.logger.error(
            `WS message failed: ${event} (socket ${socketId}) - ${(error as Error)?.message}`,
            {
              event,
              socketId,
              error: (error as Error)?.message,
              responseTime: `${Date.now() - startTime}ms`,
            },
          );
        },
      }),
    );
  }

  private interceptHttp(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url, body, query, params, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';
    const startTime = Date.now();

    // Log incoming request. The full body (redacted) is only useful for
    // local debugging, so it is logged at `debug` level; every request still
    // gets a `log`-level line without the body.
    this.logger.log(`Incoming Request: ${method} ${url}`);
    this.logger.debug(`Incoming Request body: ${method} ${url}`, {
      method,
      url,
      body: this.sanitizeBody(body),
      query,
      params,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const durationSeconds = (Date.now() - startTime) / 1000;
          const { statusCode } = response;

          // Log successful response. Response size comes from the
          // Content-Length header (set by Express once the body is
          // serialized) instead of re-stringifying the payload here.
          const responseSize = response.getHeader('content-length');

          this.logger.log(
            `Outgoing Response: ${method} ${url} - ${statusCode} - ${durationSeconds * 1000}ms`,
            {
              method,
              url,
              statusCode,
              responseTime: `${durationSeconds * 1000}ms`,
              responseSize,
              timestamp: new Date().toISOString(),
            },
          );
        },
        error: (error) => {
          const durationSeconds = (Date.now() - startTime) / 1000;
          const statusCode = (error as { status?: number }).status || 500;

          // Log error response
          this.logger.error(
            `Error Response: ${method} ${url} - ${statusCode} - ${durationSeconds * 1000}ms`,
            {
              method,
              url,
              statusCode,
              responseTime: `${durationSeconds * 1000}ms`,
              error: (error as Error).message,
              timestamp: new Date().toISOString(),
            },
          );
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    return redact(body);
  }
}
