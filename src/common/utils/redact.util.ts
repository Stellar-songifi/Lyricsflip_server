/**
 * Key patterns that should never appear in logs. Each pattern is tested
 * case-insensitively against the key name, so `newPassword`, `currentPassword`,
 * `accessToken`, `refreshToken`, `seed`, `signedXdr`, etc. are all caught.
 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word)?/i,
  /token/i,
  /secret/i,
  /xdr|transaction/i,
  /authorization/i,
  /seed/i,
];

const REDACTED = '***REDACTED***';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively walks an object/array and redacts the value of any key whose
 * name matches one of SENSITIVE_KEY_PATTERNS, at any nesting depth. Used by
 * AuditInterceptor, ErrorInterceptor and LoggingInterceptor so redaction is
 * implemented once.
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
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redact(val, seen);
      }
    }
    return result;
  }

  return value;
}