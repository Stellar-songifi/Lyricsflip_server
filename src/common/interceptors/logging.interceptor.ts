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

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
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
          const endTime = Date.now();
          const responseTime = endTime - startTime;
          const { statusCode } = response;

          // Log successful response. Response size comes from the
          // Content-Length header (set by Express once the body is
          // serialized) instead of re-stringifying the payload here.
          const responseSize = response.getHeader('content-length');

          this.logger.log(
            `Outgoing Response: ${method} ${url} - ${statusCode} - ${responseTime}ms`,
            {
              method,
              url,
              statusCode,
              responseTime: `${responseTime}ms`,
              responseSize,
              timestamp: new Date().toISOString(),
            },
          );
        },
        error: (error) => {
          const endTime = Date.now();
          const responseTime = endTime - startTime;
          const statusCode = error.status || 500;

          // Log error response
          this.logger.error(
            `Error Response: ${method} ${url} - ${statusCode} - ${responseTime}ms`,
            {
              method,
              url,
              statusCode,
              responseTime: `${responseTime}ms`,
              error: error.message,
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
