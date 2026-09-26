import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContext } from './request-context';

/**
 * Reads (or generates) an x-request-id header for each incoming request,
 * echoes it back on the response, and stores it in AsyncLocalStorage so every
 * log line emitted during that request carries the same ID without explicit
 * threading.
 *
 * Apply in AppModule: consumer.apply(RequestIdMiddleware).forRoutes('*')
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    // Echo it back so clients can correlate
    res.setHeader('x-request-id', requestId);

    // Run the rest of the pipeline inside the AsyncLocalStorage context so
    // Winston's custom format can pick it up without needing an explicit arg.
    requestContext.run({ requestId }, next);
  }
}
