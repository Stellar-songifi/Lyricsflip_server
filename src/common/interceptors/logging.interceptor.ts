import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { redact } from '../utils/redact.util';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(@Optional() private readonly metricsService?: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url, body, query, params, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';
    const startTime = Date.now();

    // Normalised route for metric labels — avoids high cardinality from
    // per-resource paths like /game-sessions/:uuid.
    const route = this.normalizeRoute(url);

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

          if (this.metricsService) {
            const labels = {
              method,
              route,
              status_code: String(statusCode),
            };
            this.metricsService.httpRequestDuration.observe(
              labels,
              durationSeconds,
            );
            this.metricsService.httpRequestTotal.inc(labels);
          }
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

          if (this.metricsService) {
            const labels = {
              method,
              route,
              status_code: String(statusCode),
            };
            this.metricsService.httpRequestDuration.observe(
              labels,
              durationSeconds,
            );
            this.metricsService.httpRequestTotal.inc(labels);
          }
        },
      }),
    );
  }

  /**
   * Normalises a URL path for use as a Prometheus label.
   *
   * Replacing UUIDs and numeric IDs with placeholders keeps label cardinality
   * bounded regardless of how many resources exist.
   */
  private normalizeRoute(url: string): string {
    const path = url.split('?')[0];
    return path
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ':uuid',
      )
      .replace(/\/\d+/g, '/:id');
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    return redact(body);
  }
}
