import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request } from 'express';
import { redact } from '../utils/redact.util';

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  method: string;
  requestId?: string;
}

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorInterceptor.name);
  private readonly isDevelopment = process.env.NODE_ENV === 'development';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      catchError((error) => {
        const errorResponse = this.formatError(error, request);
        
        this.logError(error, request);

        return throwError(() => new HttpException(errorResponse, errorResponse.statusCode));
      }),
    );
  }

  private formatError(error: any, request: Request): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;
    const method = request.method;
    const requestId = request.headers['x-request-id'] as string;

    if (error instanceof HttpException) {
      const response = error.getResponse();
      const statusCode = error.getStatus();

      return {
        statusCode,
        message: typeof response === 'string' ? response : (response as any).message,
        error: this.getErrorName(statusCode),
        timestamp,
        path,
        method,
        ...(requestId && { requestId }),
      };
    }

    if (error.name === 'ValidationError' || error.errors) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: this.extractValidationMessages(error),
        error: 'Bad Request',
        timestamp,
        path,
        method,
        ...(requestId && { requestId }),
      };
    }

    if (error.name === 'QueryFailedError' || error.code) {
      return this.handleDatabaseError(error, timestamp, path, method, requestId);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.isDevelopment ? error.message : 'Internal server error',
      error: 'Internal Server Error',
      timestamp,
      path,
      method,
      ...(requestId && { requestId }),
    };
  }

  private logError(error: any, request: Request): void {
    const { method, url, body, query, params, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';

    const errorContext = {
      method,
      url,
      body: this.sanitizeBody(body),
      query,
      params,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
    };

    if (this.isDevelopment && error.stack) {
      this.logger.error(
        `🔥 Error occurred: ${error.name} - ${error.message}`,
        error.stack,
        errorContext,
      );
    } else {
      this.logger.error(
        `🔥 Error occurred: ${error.name} - ${error.message}`,
        errorContext,
      );
    }
  }

  private handleDatabaseError(
    error: any,
    timestamp: string,
    path: string,
    method: string,
    requestId?: string,
  ): ErrorResponse {
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error occurred';

    // Handle specific database error codes
    switch (error.code) {
      case '23505': // Unique violation
        statusCode = HttpStatus.CONFLICT;
        message = 'Resource already exists';
        break;
      case '23503': // Foreign key violation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Referenced resource does not exist';
        break;
      case '23502': 
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Required field is missing';
        break;
      default:
        if (!this.isDevelopment) {
          message = 'Internal server error';
        }
    }

    return {
      statusCode,
      message: this.isDevelopment ? error.message : message,
      error: this.getErrorName(statusCode),
      timestamp,
      path,
      method,
      ...(requestId && { requestId }),
    };
  }

  private extractValidationMessages(error: any): string[] {
    if (error.errors && Array.isArray(error.errors)) {
      return error.errors.map((err: any) => err.message || err.toString());
    }
    
    if (error.message && Array.isArray(error.message)) {
      return error.message;
    }

    return [error.message || 'Validation failed'];
  }

  private getErrorName(statusCode: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };

    return errorNames[statusCode] || 'Error';
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    return redact(body);
  }
}