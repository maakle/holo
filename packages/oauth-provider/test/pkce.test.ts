import { describe, it, expect } from 'vitest';
import { verifyPkce, computeS256Challenge } from '../src/pkce';

// Known-good vector from RFC 7636 §4
// verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
// challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('computeS256Challenge', () => {
  it('matches the RFC 7636 vector', () => {
    expect(computeS256Challenge(RFC7636_VERIFIER)).toBe(RFC7636_CHALLENGE);
  });
});

describe('verifyPkce', () => {
  it('accepts matching S256 verifier', () => {
    expect(verifyPkce(RFC7636_VERIFIER, RFC7636_CHALLENGE, 'S256')).toBe(true);
  });

  it('rejects mismatched verifier', () => {
    expect(verifyPkce('not-the-verifier', RFC7636_CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects empty verifier', () => {
    expect(verifyPkce('', RFC7636_CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects non-S256 method', () => {
    // Only S256 is supported. 'plain' is rejected even if the verifier equals the challenge.
    expect(verifyPkce(RFC7636_CHALLENGE, RFC7636_CHALLENGE, 'plain' as never)).toBe(false);
  });

  it('rejects verifier shorter than 43 chars (RFC 7636 §4.1)', () => {
    expect(verifyPkce('short', computeS256Challenge('short'), 'S256')).toBe(false);
  });

  it('rejects verifier longer than 128 chars (RFC 7636 §4.1)', () => {
    const tooLong = 'a'.repeat(129);
    expect(verifyPkce(tooLong, computeS256Challenge(tooLong), 'S256')).toBe(false);
  });

  it('rejects verifier with disallowed characters (RFC 7636 §4.1)', () => {
    // Allowed charset: ALPHA / DIGIT / "-" / "." / "_" / "~"
    const bad = 'a'.repeat(43).slice(0, 42) + '!';
    expect(verifyPkce(bad, computeS256Challenge(bad), 'S256')).toBe(false);
  });
});
