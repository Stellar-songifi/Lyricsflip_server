import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import { getRequestId } from '../request-context';

/**
 * Winston-backed NestJS logger.
 *
 * Behaviour:
 *  - In production (NODE_ENV=production): every line is emitted as a single
 *    JSON object that includes `requestId` (from AsyncLocalStorage), `level`,
 *    `message`, `context` and `timestamp`. File transports are disabled unless
 *    LOG_TO_FILE=true, because writing files inside containers is generally
 *    wrong — ship logs to stdout and let the orchestrator collect them.
 *  - In development / test: a human-readable coloured format is used.
 *  - LOG_LEVEL controls the minimum level (default: info in production,
 *    debug otherwise).
 *  - LOG_TO_FILE=true adds daily-rotating files (logs/app-*.log,
 *    logs/error-*.log, logs/exceptions.log, logs/rejections.log).
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    const logToFile = process.env.LOG_TO_FILE === 'true';
    const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

    // ------------------------------------------------------------------
    // Formats
    // ------------------------------------------------------------------

    /** Injects requestId from AsyncLocalStorage into every log record. */
    const requestIdFormat = winston.format((info) => {
      const rid = getRequestId();
      if (rid) {
        info['requestId'] = rid;
      }
      return info;
    })();

    const productionFormat = winston.format.combine(
      requestIdFormat,
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

    const developmentFormat = winston.format.combine(
      requestIdFormat,
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.colorize({ all: true }),
      winston.format.printf(({ level, message, timestamp, context, requestId, stack, ...meta }) => {
        const ctx = context ? ` [${context}]` : '';
        const rid = requestId ? ` {${requestId}}` : '';
        const metaStr = Object.keys(meta).length
          ? ' ' + JSON.stringify(meta)
          : '';
        return `${timestamp}${rid} [${level}]${ctx}: ${stack ?? message}${metaStr}`;
      }),
    );

    // ------------------------------------------------------------------
    // Transports
    // ------------------------------------------------------------------

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: isProduction ? productionFormat : developmentFormat,
      }),
    ];

    if (logToFile) {
      transports.push(
        new DailyRotateFile({
          filename: 'logs/app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          level: 'info',
          format: productionFormat,
        }),
        new DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          level: 'error',
          format: productionFormat,
        }),
      );
    }

    this.logger = winston.createLogger({ level, transports });

    if (logToFile) {
      this.logger.exceptions.handle(
        new winston.transports.File({ filename: 'logs/exceptions.log' }),
      );
      this.logger.rejections.handle(
        new winston.transports.File({ filename: 'logs/rejections.log' }),
      );
    }
  }

  // ------------------------------------------------------------------
  // NestLoggerService interface
  // ------------------------------------------------------------------

  log(message: string, context?: string): void {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, { stack: trace, context });
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(message, { context });
  }

  // ------------------------------------------------------------------
  // Convenience helpers used by interceptors and filters
  // ------------------------------------------------------------------

  logRequest(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    meta?: Record<string, unknown>,
  ): void {
    this.logger.info('Request completed', {
      method,
      url,
      statusCode,
      responseTime,
      ...meta,
    });
  }

  logError(error: Error, context?: string): void {
    this.logger.error(error.message, {
      stack: error.stack,
      name: error.name,
      context,
    });
  }

  logDatabaseQuery(query: string, duration: number, context?: string): void {
    this.logger.debug('Database query executed', {
      query: query.substring(0, 200),
      duration,
      context,
    });
  }
}
