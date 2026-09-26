import { redact } from './redact.util';

describe('redact', () => {
  it('redacts top-level sensitive keys', () => {
    const result = redact({ password: 'hunter2', username: 'alice' });
    expect(result.password).toBe('***REDACTED***');
    expect(result.username).toBe('alice');
  });

  it('redacts nested sensitive keys', () => {
    const result = redact({
      user: { credentials: { accessToken: 'abc', refreshToken: 'def' } },
    });
    expect(result.user.credentials.accessToken).toBe('***REDACTED***');
    expect(result.user.credentials.refreshToken).toBe('***REDACTED***');
  });

  it('redacts sensitive keys inside arrays', () => {
    const result = redact({
      items: [{ secret: 'a' }, { newPassword: 'b', name: 'ok' }],
    });
    expect(result.items[0].secret).toBe('***REDACTED***');
    expect(result.items[1].newPassword).toBe('***REDACTED***');
    expect(result.items[1].name).toBe('ok');
  });

  it('redacts a signed transaction / XDR field', () => {
    const result = redact({ transaction: 'AAAAAgAAAAA...' });
    expect(result.transaction).toBe('***REDACTED***');
  });

  it('matches keys case-insensitively', () => {
    const result = redact({ AUTHORIZATION: 'Bearer xyz', Key: 'k' });
    expect(result.AUTHORIZATION).toBe('***REDACTED***');
    expect(result.Key).toBe('***REDACTED***');
  });

  it('leaves non-sensitive values untouched', () => {
    const result = redact({ id: 1, nested: { count: 2 } });
    expect(result).toEqual({ id: 1, nested: { count: 2 } });
  });

  it('handles null and undefined bodies', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
