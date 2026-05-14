import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  type JWK,
} from 'jose';
import {
  verifyGoogleChatJwt,
  __clearGoogleChatJwksCacheForTests,
} from '../src/google-chat/app-verify-jwt';

/**
 * JWT verification round-trips against an in-process JWKS — no network,
 * no real Google keys. We swap the remote JWKS for a local one via the
 * `jwksFetcher` test seam so the public API stays identical to production.
 */

const ISSUER = 'chat@system.gserviceaccount.com';
const AUD = '1234567890'; // pretend Cloud project number

interface TestKeySet {
  privateKey: CryptoKey;
  publicJwk: JWK;
  jwksFetcher: ReturnType<typeof createLocalJWKSet>;
}

async function makeKeys(): Promise<TestKeySet> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-kid-1';
  publicJwk.alg = 'RS256';
  const jwksFetcher = createLocalJWKSet({ keys: [publicJwk] });
  return { privateKey, publicJwk, jwksFetcher };
}

async function signToken(
  keys: TestKeySet,
  overrides: {
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
    nbf?: number;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid-1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUD)
    .setIssuedAt(overrides.iat ?? now)
    .setExpirationTime(overrides.exp ?? now + 60);
  if (overrides.nbf !== undefined) jwt.setNotBefore(overrides.nbf);
  return jwt.sign(keys.privateKey);
}

describe('verifyGoogleChatJwt', () => {
  beforeEach(() => {
    __clearGoogleChatJwksCacheForTests();
  });

  it('accepts a token signed by the expected issuer with the expected audience', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys);
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.iss).toBe(ISSUER);
      expect(result.payload.aud).toBe(AUD);
    }
  });

  it('rejects a missing Authorization header', async () => {
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: undefined,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_authorization' });
  });

  it('rejects a malformed Authorization header (no Bearer prefix)', async () => {
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: 'Basic abcdef',
    });
    expect(result).toEqual({ ok: false, reason: 'malformed_authorization' });
  });

  it('rejects when audience does not match', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, { aud: 'wrong-audience' });
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_audience' });
  });

  it('rejects when issuer is wrong', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, { iss: 'attacker@example.com' });
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_issuer' });
  });

  it('rejects an expired token', async () => {
    const keys = await makeKeys();
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(keys, { iat: now - 600, exp: now - 300 });
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    const signingKeys = await makeKeys();
    const verifyingKeys = await makeKeys();
    const token = await signToken(signingKeys);
    const result = await verifyGoogleChatJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      // Verifier has a different key set — signature won't validate.
      jwksFetcher: verifyingKeys.jwksFetcher,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either jwks_fetch_failed (no matching kid) or invalid_signature is
      // acceptable — both mean "we don't trust this".
      expect(['jwks_fetch_failed', 'invalid_signature']).toContain(result.reason);
    }
  });
});
