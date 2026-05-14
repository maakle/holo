/**
 * Google Chat App webhook authentication.
 *
 * Unlike Slack (HMAC over the raw body with a per-app signing secret),
 * Google Chat signs every event POST with a JWT in the
 * `Authorization: Bearer <jwt>` header. The JWT is issued by Google's
 * platform service account `chat@system.gserviceaccount.com`, RS256-signed
 * with a rotating key, and asserts the audience (our Cloud project number
 * for the shared app, or the BYO app's project number).
 *
 * Reference: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
 *
 * Verification steps:
 *   1. Bearer header present.
 *   2. JWT signature valid against Google's published JWKS (cached in-process).
 *   3. `iss` === `chat@system.gserviceaccount.com`.
 *   4. `aud` === expected audience (Cloud project number).
 *   5. `exp` > now, `iat`/`nbf` <= now.
 *
 * Any failure → caller returns 401 and refuses to enqueue. We never parse
 * the body before verifying; same rule as Slack HMAC.
 */
import { jwtVerify, createRemoteJWKSet, errors as joseErrors } from 'jose';
import { holoError, ErrorCode } from '@holo/errors';

const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const GOOGLE_CHAT_JWKS_URL = new URL(
  `https://www.googleapis.com/service_accounts/v1/metadata/jwk/${CHAT_ISSUER}`,
);

export type GoogleChatVerifyFailure =
  | 'missing_authorization'
  | 'malformed_authorization'
  | 'invalid_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'jwks_fetch_failed';

export type GoogleChatVerifyResult =
  | { ok: true; payload: GoogleChatVerifiedClaims }
  | { ok: false; reason: GoogleChatVerifyFailure };

export interface GoogleChatVerifiedClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface VerifyGoogleChatJwtInput {
  /**
   * Expected `aud` claim — the Cloud project number (or alternate audience
   * configured on the Chat app). Must match exactly; we never fall back to
   * issuer-only verification because that would let any Chat app forge
   * events for any Holo tenant.
   */
  audience: string;
  /** Value of the `Authorization` header on the inbound request. */
  authorizationHeader: string | null | undefined;
  /** Override JWKS for tests. */
  jwksFetcher?: ReturnType<typeof createRemoteJWKSet>;
}

// Single shared in-process JWKS cache. jose's createRemoteJWKSet handles
// rotation (re-fetches on `kid` miss) and respects the endpoint's
// Cache-Control. One instance per process is enough — the JWKS is
// audience-agnostic; only the verifier args change per call.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(GOOGLE_CHAT_JWKS_URL);
  }
  return cachedJwks;
}

/** Test seam — drop the shared JWKS cache. */
export function __clearGoogleChatJwksCacheForTests(): void {
  cachedJwks = null;
}

export async function verifyGoogleChatJwt(
  input: VerifyGoogleChatJwtInput,
): Promise<GoogleChatVerifyResult> {
  const { authorizationHeader, audience } = input;

  if (!authorizationHeader) return { ok: false, reason: 'missing_authorization' };
  // Match the literal "Bearer " prefix (case-sensitive — Google's docs and
  // real traffic use exactly this casing). Anything else is suspicious.
  if (!authorizationHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'malformed_authorization' };
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return { ok: false, reason: 'malformed_authorization' };

  const jwks = input.jwksFetcher ?? getJwks();
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: CHAT_ISSUER,
      audience,
      algorithms: ['RS256'],
    });
    // jose validates `iss`/`aud`/`exp`/`nbf` via the options above; if it
    // returns at all, the claims are good. Surface the typed claim subset.
    return {
      ok: true,
      payload: {
        iss: String(payload.iss ?? ''),
        aud: String(payload.aud ?? ''),
        iat: typeof payload.iat === 'number' ? payload.iat : 0,
        exp: typeof payload.exp === 'number' ? payload.exp : 0,
      },
    };
  } catch (err) {
    // Map jose's structured errors to our compact reasons so callers can log
    // without leaking JWT contents.
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      const claim = err.claim;
      if (claim === 'iss') return { ok: false, reason: 'wrong_issuer' };
      if (claim === 'aud') return { ok: false, reason: 'wrong_audience' };
      if (claim === 'nbf' || claim === 'iat') return { ok: false, reason: 'not_yet_valid' };
    }
    if (err instanceof joseErrors.JWKSNoMatchingKey || err instanceof joseErrors.JOSEError) {
      // JWKSTimeout, JWSSignatureVerificationFailed, etc. — all mean the
      // signature couldn't be validated against Google's published keys.
      if (
        err.code === 'ERR_JWKS_TIMEOUT' ||
        err.code === 'ERR_JWKS_INVALID' ||
        err.code === 'ERR_JWKS_NO_MATCHING_KEY'
      ) {
        return { ok: false, reason: 'jwks_fetch_failed' };
      }
      return { ok: false, reason: 'invalid_signature' };
    }
    // Catch-all: shape changed in a jose update we don't know about. Fail
    // closed rather than guessing — better a 401 than a forged event.
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Unrecognized JWT verification error from jose',
      cause: err instanceof Error ? err.message : String(err),
      fix: 'Inspect the wrapped error and add a typed branch to verifyGoogleChatJwt.',
    });
  }
}
