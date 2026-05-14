/**
 * Microsoft Teams Bot Framework JWT verification.
 *
 * Every inbound Activity arrives at `/api/messages` with
 * `Authorization: Bearer <jwt>`. The JWT is RS256-signed by the Bot
 * Connector and asserts:
 *   - `iss` === `https://api.botframework.com` (trailing slash variants
 *     observed on some channels; we accept both)
 *   - `aud` === the bot's Microsoft App ID (GUID), or the per-org App ID
 *     for the BYO route
 *   - `exp` > now, `nbf` <= now
 *   - `serviceurl` claim matches `Activity.serviceUrl` exactly (compliance
 *     bots are required to fail closed when the claim is absent or
 *     mismatched — otherwise a forged token could redirect replies)
 *
 * Reference: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 *
 * We discover the JWKS URL via OIDC metadata at
 * `https://login.botframework.com/v1/.well-known/openidconfiguration`
 * rather than hardcoding it. Microsoft's docs document this as the stable
 * contract; the JWKS endpoint itself migrates without notice.
 */
import {
  jwtVerify,
  createRemoteJWKSet,
  errors as joseErrors,
  type JWTPayload,
} from 'jose';
import { holoError, ErrorCode } from '@holo/errors';

const TEAMS_ISSUERS = new Set([
  'https://api.botframework.com',
  // Some channels emit the trailing-slash variant; accept either.
  'https://api.botframework.com/',
]);

const OIDC_METADATA_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
// OIDC metadata document is cached for 24h. JWKS rotation within the
// window is handled by jose's createRemoteJWKSet, which refreshes on a
// `kid` miss.
const OIDC_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

export type TeamsVerifyFailure =
  | 'missing_authorization'
  | 'malformed_authorization'
  | 'invalid_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'serviceurl_mismatch'
  | 'serviceurl_missing'
  | 'oidc_discovery_failed'
  | 'jwks_fetch_failed';

export type TeamsVerifyResult =
  | { ok: true; payload: TeamsVerifiedClaims }
  | { ok: false; reason: TeamsVerifyFailure };

export interface TeamsVerifiedClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  serviceurl: string;
}

export interface VerifyTeamsJwtInput {
  /** Expected `aud` — Microsoft App ID GUID (shared or per-org). */
  audience: string;
  /** Value of the `Authorization` header on the inbound request. */
  authorizationHeader: string | null | undefined;
  /**
   * `Activity.serviceUrl` from the body. Verified to match the
   * `serviceurl` claim in the JWT — without this check an attacker with
   * a stolen token could redirect outbound replies to a controlled host.
   */
  activityServiceUrl: string | undefined;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Test seam: pre-built JWKS fetcher (bypasses OIDC discovery). */
  jwksFetcher?: ReturnType<typeof createRemoteJWKSet>;
}

interface CachedDiscovery {
  jwksUri: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  fetchedAt: number;
}

let cachedDiscovery: CachedDiscovery | null = null;

/** Test seam — drop the cached OIDC discovery doc + JWKS. */
export function __clearTeamsJwksCacheForTests(): void {
  cachedDiscovery = null;
}

async function getJwksFetcher(
  fetchImpl: typeof fetch,
): Promise<ReturnType<typeof createRemoteJWKSet> | null> {
  if (
    cachedDiscovery &&
    Date.now() - cachedDiscovery.fetchedAt < OIDC_METADATA_TTL_MS
  ) {
    return cachedDiscovery.jwks;
  }
  try {
    const res = await fetchImpl(OIDC_METADATA_URL);
    if (!res.ok) return null;
    const meta = (await res.json()) as { jwks_uri?: string };
    if (!meta.jwks_uri) return null;
    const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
    cachedDiscovery = { jwksUri: meta.jwks_uri, jwks, fetchedAt: Date.now() };
    return jwks;
  } catch {
    return null;
  }
}

export async function verifyTeamsJwt(
  input: VerifyTeamsJwtInput,
): Promise<TeamsVerifyResult> {
  const { authorizationHeader, audience, activityServiceUrl } = input;
  if (!authorizationHeader) return { ok: false, reason: 'missing_authorization' };
  if (!authorizationHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'malformed_authorization' };
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return { ok: false, reason: 'malformed_authorization' };

  const fetchImpl = input.fetchImpl ?? fetch;
  const jwks = input.jwksFetcher ?? (await getJwksFetcher(fetchImpl));
  if (!jwks) return { ok: false, reason: 'oidc_discovery_failed' };

  let payload: JWTPayload;
  try {
    // We do issuer + audience + signature ourselves with jose; serviceurl
    // claim and the trailing-slash issuer variants are handled below.
    const verified = await jwtVerify(token, jwks, {
      audience,
      algorithms: ['RS256'],
    });
    payload = verified.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      const claim = err.claim;
      if (claim === 'aud') return { ok: false, reason: 'wrong_audience' };
      if (claim === 'nbf' || claim === 'iat') return { ok: false, reason: 'not_yet_valid' };
    }
    if (err instanceof joseErrors.JOSEError) {
      if (
        err.code === 'ERR_JWKS_TIMEOUT' ||
        err.code === 'ERR_JWKS_INVALID' ||
        err.code === 'ERR_JWKS_NO_MATCHING_KEY'
      ) {
        return { ok: false, reason: 'jwks_fetch_failed' };
      }
      return { ok: false, reason: 'invalid_signature' };
    }
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Unrecognized JWT verification error from jose',
      cause: err instanceof Error ? err.message : String(err),
      fix: 'Inspect the wrapped error and add a typed branch to verifyTeamsJwt.',
    });
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!TEAMS_ISSUERS.has(iss)) {
    return { ok: false, reason: 'wrong_issuer' };
  }

  // serviceurl claim: per Microsoft's compliance guidance, the claim must
  // be present and match the Activity's serviceUrl exactly. We never
  // canonicalize trailing slashes — the docs warn that some channels
  // expect the slash preserved and silently mismatch if it's stripped.
  const claimServiceUrl =
    typeof payload['serviceurl'] === 'string'
      ? (payload['serviceurl'] as string)
      : undefined;
  if (!claimServiceUrl) return { ok: false, reason: 'serviceurl_missing' };
  if (!activityServiceUrl || claimServiceUrl !== activityServiceUrl) {
    return { ok: false, reason: 'serviceurl_mismatch' };
  }

  return {
    ok: true,
    payload: {
      iss,
      aud: String(payload.aud ?? ''),
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
      serviceurl: claimServiceUrl,
    },
  };
}
