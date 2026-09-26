/**
 * Keys that should never appear in logs, matched case-insensitively as a
 * substring so `newPassword`, `accessToken` and `refreshToken` are caught
 * along with the exact field names.
 */
const SENSITIVE_KEY_PATTERN =
  /pass|token|secret|key|authorization|transaction|seed/i;

const REDACTED = '***REDACTED***';

/**
 * Recursively walks an object/array and redacts the value of any key whose
 * name matches SENSITIVE_KEY_PATTERN, at any nesting depth. Used by
 * ErrorInterceptor and LoggingInterceptor so redaction is implemented once.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redact(val, seen);
      }
    }
    return result;
  }

  return value;
}
