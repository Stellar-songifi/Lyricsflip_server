import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AUDIT_ACTION_KEY, AuditedOptions } from './decorators/audited.decorator';

/** The parts of a call the audit row records. An Express request fits. */
interface AuditSource {
  user?: { id?: string };
  params?: Record<string, string>;
  query?: unknown;
  body?: unknown;
  ip?: string;
}

const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'transaction', 'authorization'];

/**
 * Writes an `audit_logs` row after a handler marked `@Audited(...)`
 * completes successfully.
 *
 * Runs after the handler (via `tap`, not `catchError`), so a failed request
 * - one that never actually deleted the user or settled the wager - does not
 * create a row implying it did. The actor is read from `request.user` (set
 * by `JwtAuthGuard`), so this only ever runs behind that guard in practice.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditedOptions | undefined>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return next.handle();
    }

    const source = this.auditSource(context);
    if (!source) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((result) => {
        // Audit writes must never block or fail the response they describe -
        // an outage in the audit table should not stop a delete or a
        // settlement from succeeding.
        void this.write(options, source, result).catch(() => undefined);
      }),
    );
  }

  /**
   * The request-like view of the call being audited (#362). For HTTP it is
   * the Express request. For a WebSocket message the actor is the socket's
   * `client.data.user`, the payload is the message body and the IP is the
   * handshake address. Other contexts have nothing to attribute, so they are
   * not audited.
   */
  private auditSource(context: ExecutionContext): AuditSource | null {
    switch (context.getType()) {
      case 'http':
        return context.switchToHttp().getRequest<Request>();
      case 'ws': {
        const ws = context.switchToWs();
        const client = ws.getClient<{
          data?: { user?: { id?: string } };
          handshake?: { address?: string };
        }>();
        const data = ws.getData<unknown>();
        return {
          user: client?.data?.user,
          params: {},
          query: {},
          body: data,
          ip: client?.handshake?.address,
        };
      }
      default:
        return null;
    }
  }

  private async write(
    options: AuditedOptions,
    request: AuditSource,
    result: unknown,
  ): Promise<void> {
    const user = request.user;
    const targetParam = options.targetParam ?? 'id';
    const targetId =
      request.params?.[targetParam] ?? this.extractIdFromResult(result) ?? null;

    await this.auditService.record({
      actorId: user?.id ?? 'system',
      action: options.action,
      targetType: options.targetType ?? null,
      targetId,
      ip: request.ip ?? null,
      payload: {
        params: request.params,
        query: request.query,
        body: this.sanitize(request.body),
      },
    });
  }

  private extractIdFromResult(result: unknown): string | null {
    if (result && typeof result === 'object' && 'id' in result) {
      const id = (result as { id?: unknown }).id;
      return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
    }
    return null;
  }

  private sanitize(body: unknown): unknown {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sanitized: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const field of SENSITIVE_FIELDS) {
      if (field in sanitized) {
        sanitized[field] = '***REDACTED***';
      }
    }
    return sanitized;
  }
}
