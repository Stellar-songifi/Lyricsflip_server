import { isIP } from 'net';

/**
 * Truncates an IP address so it identifies a network, not a person
 * (docs/DATA_ARCHIVING.md, "Personal data retention"):
 *
 *   IPv4  203.0.113.57        -> 203.0.113.0      (/24)
 *   IPv6  2001:db8:85a3:8d3:: -> 2001:db8:85a3::  (/48)
 *
 * IPv4-mapped IPv6 addresses (::ffff:203.0.113.57) are treated as IPv4.
 * Anything that is not an IP address returns null.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }

  const address = ip.trim().replace(/^::ffff:/i, '');

  if (isIP(address) === 4) {
    const octets = address.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  if (isIP(address) === 6) {
    const groups = expandIpv6(address);
    return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::`;
  }

  return null;
}

function expandIpv6(address: string): string[] {
  const [head, tail = ''] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = address.includes('::') && tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  return [
    ...headGroups,
    ...Array<string>(Math.max(missing, 0)).fill('0'),
    ...tailGroups,
  ];
}
