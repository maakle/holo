import { createHash, timingSafeEqual } from 'node:crypto';
import type { CodeChallengeMethod } from './types';

// RFC 7636: code_verifier ALPHA / DIGIT / "-" / "." / "_" / "~", length 43–128.
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function computeS256Challenge(verifier: string): string {
  const digest = createHash('sha256').update(verifier).digest();
  return base64UrlEncode(digest);
}

export function verifyPkce(
  verifier: string,
  challenge: string,
  method: CodeChallengeMethod | string,
): boolean {
  if (method !== 'S256') return false;
  if (!VERIFIER_RE.test(verifier)) return false;

  const computed = computeS256Challenge(verifier);
  // Constant-time compare to avoid timing oracles.
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
