import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit:action';

export interface AuditedOptions {
  /** Machine-readable action name, e.g. `admin.user.delete`. */
  action: string;
  /** Route param that identifies the target, e.g. `id`. Defaults to `id`. */
  targetParam?: string;
  /** Kind of thing the target is, e.g. `user`, `wager`. */
  targetType?: string;
}

/**
 * Marks a handler as needing an audit row on success. Read by
 * `AuditInterceptor`, which does the actual writing.
 *
 * `@Audited('admin.user.delete')` is shorthand for
 * `@Audited({ action: 'admin.user.delete' })`.
 */
export const Audited = (action: string | AuditedOptions) =>
  SetMetadata(
    AUDIT_ACTION_KEY,
    typeof action === 'string' ? { action } : action,
  );
