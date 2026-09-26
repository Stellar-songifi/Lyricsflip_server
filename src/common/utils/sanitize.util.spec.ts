import { sanitizeForDisplay } from './sanitize.util';

describe('sanitizeForDisplay', () => {
  it('strips newlines that could forge extra log lines', () => {
    expect(sanitizeForDisplay('alice\n2026-01-01 FAKE admin login')).toBe(
      'alice2026-01-01 FAKE admin login',
    );
  });

  it('strips carriage returns and other control characters', () => {
    expect(sanitizeForDisplay('bob\r\t\u0007')).toBe('bob');
  });

  it('leaves an ordinary username untouched', () => {
    expect(sanitizeForDisplay('lyric_fan_99')).toBe('lyric_fan_99');
  });

  it('handles null and undefined without throwing', () => {
    expect(sanitizeForDisplay(null)).toBe('');
    expect(sanitizeForDisplay(undefined)).toBe('');
  });
});
