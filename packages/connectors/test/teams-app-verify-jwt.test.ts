import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  type JWK,
} from 'jose';
import {
  verifyTeamsJwt,
  __clearTeamsJwksCacheForTests,
} from '../src/teams/app-verify-jwt';

/**
 * JWT verification round-trips against an in-process JWKS — no network,
 * no real Bot Framework keys. We bypass OIDC discovery via the
 * `jwksFetcher` test seam so the public API stays identical to
 * production while keeping the test hermetic.
 */

const ISSUER = 'https://api.botframework.com';
const AUD = '11111111-2222-3333-4444-555555555555'; // pretend bot App ID
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';

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
    serviceurl?: string | null;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {};
  if (overrides.serviceurl !== null) {
    claims['serviceurl'] = overrides.serviceurl ?? SERVICE_URL;
  }
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid-1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUD)
    .setIssuedAt(overrides.iat ?? now)
    .setExpirationTime(overrides.exp ?? now + 60);
  if (overrides.nbf !== undefined) jwt.setNotBefore(overrides.nbf);
  return jwt.sign(keys.privateKey);
}

describe('verifyTeamsJwt', () => {
  beforeEach(() => {
    __clearTeamsJwksCacheForTests();
  });

  it('accepts a token with matching audience, issuer, and serviceurl claim', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys);
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.iss).toBe(ISSUER);
      expect(result.payload.aud).toBe(AUD);
      expect(result.payload.serviceurl).toBe(SERVICE_URL);
    }
  });

  it('accepts the trailing-slash issuer variant', async () => {
    // Some Teams channels emit `https://api.botframework.com/` with a
    // trailing slash — both forms are documented as the same identity.
    const keys = await makeKeys();
    const token = await signToken(keys, { iss: 'https://api.botframework.com/' });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing Authorization header', async () => {
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: undefined,
      activityServiceUrl: SERVICE_URL,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_authorization' });
  });

  it('rejects a malformed Authorization header (no Bearer prefix)', async () => {
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: 'Basic abcdef',
      activityServiceUrl: SERVICE_URL,
    });
    expect(result).toEqual({ ok: false, reason: 'malformed_authorization' });
  });

  it('rejects when audience does not match the bot App ID', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, { aud: 'wrong-audience' });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_audience' });
  });

  it('rejects when issuer is not the Bot Framework', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, { iss: 'https://attacker.example.com' });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_issuer' });
  });

  it('rejects an expired token', async () => {
    const keys = await makeKeys();
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(keys, { iat: now - 600, exp: now - 300 });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects when the serviceurl claim is absent (compliance bots must fail closed)', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, { serviceurl: null });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'serviceurl_missing' });
  });

  it('rejects when the serviceurl claim does not match Activity.serviceUrl', async () => {
    // The Teams-specific case: a stolen/replayed token claiming a
    // different region must not be allowed to redirect outbound replies.
    const keys = await makeKeys();
    const token = await signToken(keys, {
      serviceurl: 'https://attacker.example.com/',
    });
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'serviceurl_mismatch' });
  });

  it('rejects when activityServiceUrl is missing (caller failed to pass it through)', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys);
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: undefined,
      jwksFetcher: keys.jwksFetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'serviceurl_mismatch' });
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    const signingKeys = await makeKeys();
    const verifyingKeys = await makeKeys();
    const token = await signToken(signingKeys);
    const result = await verifyTeamsJwt({
      audience: AUD,
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      jwksFetcher: verifyingKeys.jwksFetcher,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either jwks_fetch_failed (no matching kid) or invalid_signature
      // is acceptable — both mean "we don't trust this".
      expect(['jwks_fetch_failed', 'invalid_signature']).toContain(result.reason);
    }
  });
});
