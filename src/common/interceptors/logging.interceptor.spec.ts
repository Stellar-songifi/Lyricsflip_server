import { Test } from '@nestjs/testing';
import { LoggingInterceptor } from './logging.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [LoggingInterceptor],
    }).compile();

    interceptor = module.get<LoggingInterceptor>(LoggingInterceptor);

    mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          url: '/test',
          body: { test: 'data' },
          query: { page: 1 },
          params: { id: 1 },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'test-agent' },
        }),
        getResponse: () => ({
          statusCode: 200,
          getHeader: () => undefined,
        }),
      }),
    } as ExecutionContext;

    mockCallHandler = {
      handle: jest.fn(),
    };
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should log successful requests', (done) => {
    const logSpy = jest.spyOn(interceptor['logger'], 'log');
    mockCallHandler.handle = jest.fn(() => of({ data: 'test' }));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe(() => {
      expect(logSpy).toHaveBeenCalledTimes(2); 
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Incoming Request'),
        expect.any(Object),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Outgoing Response'),
        expect.any(Object),
      );
      done();
    });
  });

  it('should log errors', (done) => {
    const errorSpy = jest.spyOn(interceptor['logger'], 'error');
    const testError = new Error('Test error');
    testError['status'] = 500;
    
    mockCallHandler.handle = jest.fn(() => throwError(() => testError));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      error: () => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error Response'),
          expect.any(Object),
        );
        done();
      },
    });
  });

  it('should sanitize sensitive data', () => {
    const sensitiveBody = {
      username: 'user',
      password: 'secret123',
      token: 'jwt-token',
    };

    const sanitized = interceptor['sanitizeBody'](sensitiveBody);
    
    expect(sanitized.username).toBe('user');
    expect(sanitized.password).toBe('***REDACTED***');
    expect(sanitized.token).toBe('***REDACTED***');
  });

  describe('in a WebSocket handler (#362)', () => {
    class FakeGateway {
      handleSubmitGuess() {
        return undefined;
      }
    }
    Reflect.defineMetadata(
      'message',
      'submitGuess',
      FakeGateway.prototype.handleSubmitGuess,
    );

    const wsContext = {
      getType: () => 'ws',
      getHandler: () => FakeGateway.prototype.handleSubmitGuess,
      getClass: () => FakeGateway,
      switchToHttp: () => {
        throw new Error('switchToHttp must not be used for a socket');
      },
      switchToWs: () => ({
        getClient: () => ({ id: 'socket-42', data: {} }),
        getData: () => ({ guess: 'x' }),
      }),
    } as unknown as ExecutionContext;

    it('logs the event name and socket ID', (done) => {
      const logSpy = jest.spyOn(interceptor['logger'], 'log');
      mockCallHandler.handle = jest.fn(() => of({ ok: true }));

      interceptor.intercept(wsContext, mockCallHandler).subscribe(() => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('submitGuess (socket socket-42)'),
        );
        done();
      });
    });

    it('logs and rethrows the real error', (done) => {
      const errorSpy = jest.spyOn(interceptor['logger'], 'error');
      mockCallHandler.handle = jest.fn(() =>
        throwError(() => new Error('round already closed')),
      );

      interceptor.intercept(wsContext, mockCallHandler).subscribe({
        error: (error: Error) => {
          expect(error.message).toBe('round already closed');
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('round already closed'),
            expect.objectContaining({
              event: 'submitGuess',
              socketId: 'socket-42',
            }),
          );
          done();
        },
      });
    });
  });

  it('passes other context types straight through', (done) => {
    const rpcContext = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('switchToHttp must not be used');
      },
    } as unknown as ExecutionContext;
    mockCallHandler.handle = jest.fn(() => of('result'));

    interceptor.intercept(rpcContext, mockCallHandler).subscribe((value) => {
      expect(value).toBe('result');
      done();
    });
  });
});
