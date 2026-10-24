import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Route label for a request that matched no route (404s, scanner probes). */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * The route template a request matched (the full Express path, with the API
 * prefix and `:params`), or {@link UNMATCHED_ROUTE}.
 *
 * Express sets `req.route` once a route matches, before Nest's guards, pipes
 * and handler run, so requests those reject are labelled with their template
 * too. Labelling with the template rather than the URL keeps the number of
 * time series bounded by the number of routes: `/rooms/join/AB12CD`,
 * `/users/alice/public` or a scanner's random paths no longer each create one
 * (#361).
 */
export function routeTemplate(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string' || path === '') {
    return UNMATCHED_ROUTE;
  }
  return `${req.baseUrl ?? ''}${path}`;
}

/**
 * Records `lyricsflip_http_requests_total` and
 * `lyricsflip_http_request_duration_seconds` for every response.
 *
 * It runs as plain Express middleware, installed in main.ts before any route,
 * and records when the response finishes. An interceptor (where this used to
 * live) never sees requests rejected by a guard (401, 403, 429) or a pipe
 * (400), nor 404s, which are exactly the rates worth alerting on.
 */
export function createHttpMetricsMiddleware(
  metrics: MetricsService,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    let recorded = false;

    const record = () => {
      if (recorded) return;
      recorded = true;
      const labels = {
        method: req.method,
        route: routeTemplate(req),
        status_code: String(res.statusCode),
      };
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.httpRequestDuration.observe(labels, seconds);
      metrics.httpRequestTotal.inc(labels);
    };

    res.once('finish', record);
    // A client that disconnects before the response is sent still counts.
    res.once('close', record);
    next();
  };
}
