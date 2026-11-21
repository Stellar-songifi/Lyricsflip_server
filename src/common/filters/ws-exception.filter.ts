import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

import {
  DomainException,
  ErrorCode,
  errorCodeForStatus,
} from '../exceptions/domain.exception';

export interface WsErrorPayload {
  code: ErrorCode;
  statusCode: number;
  message: string;
  details?: unknown;
}

export interface WsErrorEnvelope {
  event: 'error';
  data: WsErrorPayload;
}

/**
 * Maps HTTP and WebSocket exceptions to a stable error contract for socket
 * clients: `{ event: 'error', data: { code, statusCode, message, details } }`.
 *
 * When the client supplied an ack callback, the payload is delivered through
 * it instead of (or in addition to) the `error` event.
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const data = host.switchToWs().getData<unknown>();
    const payload = this.toPayload(exception);

    if (payload.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `WebSocket error: ${payload.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const ack =
      this.extractAck(host.getArgByIndex?.<unknown>(2)) ??
      this.extractAck(data);
    if (ack) {
      ack(payload);
      return;
    }

    if (client && typeof client.emit === 'function') {
      const envelope: WsErrorEnvelope = { event: 'error', data: payload };
      client.emit('error', envelope);
    }
  }

  private toPayload(exception: unknown): WsErrorPayload {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] }).message;

      return {
        statusCode,
        code:
          exception instanceof DomainException
            ? exception.code
            : errorCodeForStatus(statusCode),
        message: Array.isArray(message)
          ? message.join(', ')
          : (message ?? exception.message),
        details:
          exception instanceof DomainException ? exception.details : undefined,
      };
    }

    if (exception instanceof WsException) {
      const error = exception.getError();
      const obj =
        typeof error === 'object'
          ? (error as Record<string, unknown>)
          : undefined;
      const rawCode = obj?.code;
      const statusCode =
        typeof rawCode === 'number' ? rawCode : HttpStatus.BAD_REQUEST;
      const explicitCode = Object.values(ErrorCode).find(
        (code) => code === rawCode,
      );
      return {
        statusCode,
        code: explicitCode ?? errorCodeForStatus(statusCode),
        message: typeof error === 'string' ? error : exception.message,
        details: obj?.details ?? obj,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private extractAck(
    data: unknown,
  ): ((payload: WsErrorPayload) => void) | null {
    if (typeof data === 'function') {
      return data as (payload: WsErrorPayload) => void;
    }
    if (data && typeof data === 'object') {
      const candidate = (data as Record<string, unknown>).ack;
      if (typeof candidate === 'function') {
        return candidate as (payload: WsErrorPayload) => void;
      }
    }
    return null;
  }
}
