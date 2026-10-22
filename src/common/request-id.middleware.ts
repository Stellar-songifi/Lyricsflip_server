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
    const incoming = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

    // Echo it back so clients can correlate
    res.setHeader('x-request-id', requestId);

    // Make the resolved ID visible to code that reads the request directly
    // (the exception filter, interceptors), not only to the logger (#360).
    req.headers['x-request-id'] = requestId;
    (req as Request & { id?: string }).id = requestId;

    // Run the rest of the pipeline inside the AsyncLocalStorage context so
    // Winston's custom format can pick it up without needing an explicit arg.
    requestContext.run({ requestId }, next);
  }
}
