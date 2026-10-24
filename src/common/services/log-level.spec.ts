import * as winston from 'winston';
import { envValidationSchema } from '../../config/env.validation';
import {
  ACCEPTED_LOG_LEVELS,
  defaultLogLevel,
  resolveLogLevel,
} from './log-level';
import { LoggerService } from './logger.service';

/**
 * #359: LOG_LEVEL=log silenced every message (Winston has no `log` level),
 * and Winston's own `info` was rejected at boot. Every accepted value must
 * still let errors through, and `info` must validate.
 */

const BASE_ENV = {
  JWT_SECRET: 'x'.repeat(32),
  DB_HOST: 'localhost',
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
};

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(
    { ...BASE_ENV, ...env },
    { allowUnknown: true },
  );
}

describe('LOG_LEVEL validation', () => {
  it.each(ACCEPTED_LOG_LEVELS)('accepts %s', (level) => {
    expect(validate({ LOG_LEVEL: level }).error).toBeUndefined();
  });

  it('accepts info, the documented production level', () => {
    expect(
      validate({ LOG_LEVEL: 'info', NODE_ENV: 'production' }).error,
    ).toBeUndefined();
  });

  it('rejects levels Winston does not have', () => {
    expect(validate({ LOG_LEVEL: 'trace' }).error).toBeDefined();
    expect(validate({ LOG_LEVEL: 'silly' }).error).toBeDefined();
  });

  it('defaults to info in production and debug otherwise', () => {
    expect(validate({ NODE_ENV: 'production' }).value.LOG_LEVEL).toBe('info');
    expect(validate({ NODE_ENV: 'development' }).value.LOG_LEVEL).toBe('debug');
    expect(validate({}).value.LOG_LEVEL).toBe('debug');
  });
});

describe('resolveLogLevel', () => {
  it("maps Nest's log to info", () => {
    expect(resolveLogLevel('log', 'production')).toBe('info');
  });

  it('passes Winston levels through and falls back to the environment default', () => {
    expect(resolveLogLevel('warn', undefined)).toBe('warn');
    expect(resolveLogLevel(undefined, 'production')).toBe(
      defaultLogLevel('production'),
    );
    expect(resolveLogLevel('nonsense', 'test')).toBe('debug');
  });
});

describe('LoggerService emits errors at every accepted level', () => {
  const originalLevel = process.env.LOG_LEVEL;
  let written: jest.SpyInstance;

  beforeEach(() => {
    written = jest
      .spyOn(winston.transports.Console.prototype, 'log')
      .mockImplementation(function (
        this: unknown,
        _info: unknown,
        callback?: () => void,
      ) {
        callback?.();
      } as never);
  });

  afterEach(() => {
    written.mockRestore();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  it.each(ACCEPTED_LOG_LEVELS)(
    'LOG_LEVEL=%s still writes an error',
    async (level) => {
      process.env.LOG_LEVEL = level;
      const logger = new LoggerService();

      logger.error('database exploded');
      await new Promise((resolve) => setImmediate(resolve));

      const messages = written.mock.calls.map(
        ([info]) => (info as { message?: string }).message,
      );
      expect(messages).toContain('database exploded');
    },
  );
});
