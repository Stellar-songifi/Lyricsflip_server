import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as express from 'express';
import * as request from 'supertest';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { getRequestId } from './request-context';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * #360: when a client sent no x-request-id, the middleware generated one
 * (used by every log line) and the exception filter then generated a second
 * one for the error body and response header. One request must have one ID
 * everywhere: logs, response header and error body.
 */

function hostFor(req: express.Request, res: express.Response): ArgumentsHost {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

function buildApp(seen: {
  logContextId?: string;
  reqId?: string;
  header?: string;
}) {
  const filter = new AllExceptionsFilter();
  const middleware = new RequestIdMiddleware();
  const app = express();
  app.use((req, res, next) => middleware.use(req, res, next));
  app.get('/boom', (req) => {
    // What a log line written during the request would carry.
    seen.logContextId = getRequestId();
    seen.reqId = (req as express.Request & { id?: string }).id;
    seen.header = req.headers['x-request-id'] as string;
    throw new HttpException('Nope', HttpStatus.BAD_REQUEST);
  });
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      filter.catch(err, hostFor(req, res));
    },
  );
  return app;
}

describe('request ID consistency (#360)', () => {
  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => logged.mockRestore());

  it('uses one generated ID in the logs, the response header and the error body', async () => {
    const seen: { logContextId?: string; reqId?: string; header?: string } = {};
    const res = await request(buildApp(seen)).get('/boom');

    expect(res.status).toBe(400);
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(id);
    expect(seen.logContextId).toBe(id);
    expect(seen.reqId).toBe(id);
    expect(seen.header).toBe(id);
    // The filter's own error log carries the same ID.
    const loggedContext = logged.mock.calls[0][
      logged.mock.calls[0].length - 1
    ] as { requestId?: string };
    expect(loggedContext.requestId).toBe(id);
  });

  it('keeps an incoming x-request-id end to end', async () => {
    const seen: { logContextId?: string } = {};
    const res = await request(buildApp(seen))
      .get('/boom')
      .set('x-request-id', 'client-supplied-id');

    expect(res.headers['x-request-id']).toBe('client-supplied-id');
    expect(res.body.requestId).toBe('client-supplied-id');
    expect(seen.logContextId).toBe('client-supplied-id');
  });

  it('still produces an ID for errors raised outside the middleware', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    const setHeader = jest.fn();
    const res = {
      status: jest.fn().mockReturnValue({ json }),
      setHeader,
      getHeader: () => undefined,
    };
    const req = { url: '/x', method: 'GET', ip: '127.0.0.1', headers: {} };

    filter.catch(new Error('early'), hostFor(req as never, res as never));

    const id = setHeader.mock.calls[0][1] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: id }),
    );
  });
});
