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
