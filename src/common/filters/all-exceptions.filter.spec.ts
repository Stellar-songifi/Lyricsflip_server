import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockHost: ArgumentsHost;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setHeaderMock: jest.Mock;
  let requestHeaders: Record<string, string>;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jsonMock = jest.fn();
    setHeaderMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    requestHeaders = {};

    mockHost = {
      switchToHttp: () => ({
        getRequest: () => ({
          url: '/test',
          method: 'GET',
          ip: '127.0.0.1',
          headers: requestHeaders,
        }),
        getResponse: () => ({
          status: statusMock,
          setHeader: setHeaderMock,
        }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats an HttpException using its own status and message', () => {
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not found',
        error: 'Not Found',
        path: '/test',
        method: 'GET',
      }),
    );
  });

  it('maps a Postgres unique-violation QueryFailedError to 409', () => {
    const error = new QueryFailedError('query', [], new Error('duplicate key'));
    (error as unknown as { code: string }).code = '23505';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        message: 'Resource already exists',
      }),
    );
  });

  it('maps an invalid-text-representation QueryFailedError to 400', () => {
    const error = new QueryFailedError('query', [], new Error('invalid input'));
    (error as unknown as { code: string }).code = '22P02';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid input syntax',
      }),
    );
  });

  it('maps a string-too-long QueryFailedError to 400', () => {
    const error = new QueryFailedError('query', [], new Error('too long'));
    (error as unknown as { code: string }).code = '22001';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Value too long',
      }),
    );
  });

  it('maps a check-violation QueryFailedError to 400', () => {
    const error = new QueryFailedError('query', [], new Error('check'));
    (error as unknown as { code: string }).code = '23514';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Value violates a constraint',
      }),
    );
  });

  it('maps a serialisation-failure QueryFailedError to 409', () => {
    const error = new QueryFailedError('query', [], new Error('serialisation'));
    (error as unknown as { code: string }).code = '40001';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        message: expect.stringContaining('retry'),
      }),
    );
  });

  it('maps a deadlock-detected QueryFailedError to 503', () => {
    const error = new QueryFailedError('query', [], new Error('deadlock'));
    (error as unknown as { code: string }).code = '40P01';

    filter.catch(error, mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: expect.stringContaining('retry'),
      }),
    );
  });

  it('uses production-safe messages for mapped database errors', () => {
    process.env.NODE_ENV = 'production';
    const prodFilter = new AllExceptionsFilter();

    const error = new QueryFailedError('query', [], new Error('raw detail'));
    (error as unknown as { code: string }).code = '22P02';

    prodFilter.catch(error, mockHost);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid input syntax',
      }),
    );

    process.env.NODE_ENV = 'test';
  });

  it('names a 429 response "Too Many Requests"', () => {
    filter.catch(
      new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS),
      mockHost,
    );

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
      }),
    );
  });

  it('names a 410 response "Gone"', () => {
    filter.catch(new HttpException('Expired', HttpStatus.GONE), mockHost);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.GONE);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.GONE,
        error: 'Gone',
      }),
    );
  });

  it('hides an unknown error message in production', () => {
    process.env.NODE_ENV = 'production';
    const prodFilter = new AllExceptionsFilter();

    prodFilter.catch(new Error('table "users" violates constraint'), mockHost);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );

    process.env.NODE_ENV = 'test';
  });

  it('echoes back an incoming x-request-id', () => {
    requestHeaders['x-request-id'] = 'abc-123';

    filter.catch(new HttpException('bad', HttpStatus.BAD_REQUEST), mockHost);

    expect(setHeaderMock).toHaveBeenCalledWith('x-request-id', 'abc-123');
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abc-123' }),
    );
  });

  it('generates a request id when none was supplied', () => {
    filter.catch(new HttpException('bad', HttpStatus.BAD_REQUEST), mockHost);

    expect(setHeaderMock).toHaveBeenCalledWith('x-request-id', expect.any(String));
  });
});
