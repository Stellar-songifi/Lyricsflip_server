import { truncateIp } from './ip.util';

describe('truncateIp', () => {
  it('keeps the /24 of an IPv4 address', () => {
    expect(truncateIp('203.0.113.57')).toBe('203.0.113.0');
  });

  it('treats IPv4-mapped IPv6 as IPv4', () => {
    expect(truncateIp('::ffff:203.0.113.57')).toBe('203.0.113.0');
  });

  it('keeps the /48 of an IPv6 address', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(
      '2001:db8:85a3::',
    );
  });

  it('expands compressed IPv6 before truncating', () => {
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
  });

  it('returns null for empty or invalid input', () => {
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('')).toBeNull();
    expect(truncateIp('not-an-ip')).toBeNull();
  });
});
