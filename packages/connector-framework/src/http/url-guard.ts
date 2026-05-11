import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { holoError, ErrorCode } from '@holo/errors';

/**
 * Reject `url` if it parses to a non-public destination — i.e. anything that
 * could let an authenticated caller fan outbound HTTPS at internal services
 * (cloud metadata, private subnets, loopback). Used by every connector
 * connect handler that accepts a user-supplied URL.
 *
 * Hostnames are resolved with `dns.lookup`; **all** returned addresses must
 * be public, so an attacker can't bypass the check via a record that
 * resolves to e.g. both 1.1.1.1 and 169.254.169.254.
 */
export interface AssertPublicUrlOptions {
  /** Optional host suffix allowlist (e.g. `['.zendesk.com']`). Case-insensitive. */
  allowedHostSuffixes?: readonly string[];
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  options: AssertPublicUrlOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${rawUrl}" is not a valid URL`,
      fix: 'Use a full URL like https://example.com.',
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Unsupported protocol: ${parsed.protocol}`,
      fix: 'Use http:// or https://.',
    });
  }

  // URL.hostname returns IPv6 literals wrapped in brackets ("[::1]"); strip
  // them so isIP() and the DNS path see the bare address/hostname.
  const host = parsed.hostname.toLowerCase().replace(/^\[(.+)\]$/, '$1');
  if (options.allowedHostSuffixes && options.allowedHostSuffixes.length > 0) {
    const ok = options.allowedHostSuffixes.some((suffix) => {
      const s = suffix.toLowerCase();
      return host === s.replace(/^\./, '') || host.endsWith(s.startsWith('.') ? s : `.${s}`);
    });
    if (!ok) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Host "${host}" is not on the allowlist`,
        fix: `Use a URL whose host ends with one of: ${options.allowedHostSuffixes.join(', ')}.`,
      });
    }
  }

  // Literal IP in the URL: validate directly without DNS.
  const literal = isIP(host);
  if (literal) {
    if (!isPublicIp(host)) {
      throw rejectPrivate(host);
    }
    return parsed;
  }

  // Resolve every A/AAAA record. `all: true` lets us check the full set so
  // an attacker can't slip a private address into a multi-record response.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `DNS lookup failed for "${host}"`,
      cause: (err as Error).message,
      fix: 'Verify the host is reachable from the public internet.',
    });
  }
  if (addrs.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${host}" did not resolve to any address`,
      fix: 'Verify the host is reachable from the public internet.',
    });
  }
  for (const a of addrs) {
    if (!isPublicIp(a.address)) {
      throw rejectPrivate(`${host} → ${a.address}`);
    }
  }
  return parsed;
}

function rejectPrivate(target: string) {
  return holoError({
    code: ErrorCode.HOLO_INVALID_INPUT,
    problem: `"${target}" resolves to a non-public address`,
    fix: 'Use a public hostname; private/loopback/metadata addresses are rejected.',
  });
}

/** True if `addr` is a routable public unicast IP (v4 or v6). */
export function isPublicIp(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return isPublicIpv4(addr);
  if (v === 6) return isPublicIpv6(addr);
  return false;
}

function isPublicIpv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  // 0.0.0.0/8 — "this network"
  if (a === 0) return false;
  // 10.0.0.0/8 — RFC 1918
  if (a === 10) return false;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return false;
  // 127.0.0.0/8 — loopback
  if (a === 127) return false;
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return false;
  // 172.16.0.0/12 — RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.0.0.0/24 — IETF Protocol Assignments
  if (a === 192 && b === 0 && parts[2] === 0) return false;
  // 192.0.2.0/24 — TEST-NET-1
  if (a === 192 && b === 0 && parts[2] === 2) return false;
  // 192.168.0.0/16 — RFC 1918
  if (a === 192 && b === 168) return false;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return false;
  // 198.51.100.0/24 — TEST-NET-2
  if (a === 198 && b === 51 && parts[2] === 100) return false;
  // 203.0.113.0/24 — TEST-NET-3
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  // 224.0.0.0/4 — multicast; 240.0.0.0/4 — reserved; 255.255.255.255 — broadcast
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  // ::1 loopback, :: unspecified
  if (lower === '::1' || lower === '::') return false;
  // IPv4-mapped (::ffff:a.b.c.d) — defer to v4 check
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPublicIpv4(mapped[1]!);
  // fc00::/7 — unique local
  if (/^f[cd]/.test(lower)) return false;
  // fe80::/10 — link-local
  if (/^fe[89ab]/.test(lower)) return false;
  // ff00::/8 — multicast
  if (lower.startsWith('ff')) return false;
  // 2001:db8::/32 — documentation
  if (lower.startsWith('2001:db8')) return false;
  return true;
}
