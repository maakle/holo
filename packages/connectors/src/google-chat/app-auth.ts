/**
 * App-level Google access token minting for the Chat App.
 *
 * The conversational bot authenticates as the service account itself (no
 * user impersonation), unlike the read-only ingestion connector which uses
 * domain-wide delegation. We sign a self-issued JWT (RS256) with the SA
 * private key and exchange it at Google's OAuth token endpoint with the
 * `chat.bot` scope.
 *
 * Distinct from `google-shared/service-account.ts:mintDelegatedAccessToken`
 * because that helper always sets a `sub` (impersonation email). For the
 * Chat App we omit `sub` — the token is for the SA's own identity.
 *
 * In-process token cache keyed by SA client_email so repeated outbound
 * calls in the same worker incarnation reuse one bearer token.
 */
import { SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { holoError, ErrorCode } from '@holo/errors';
import { parseServiceAccountKey } from '../google-shared/service-account';
import type { GoogleServiceAccountKey } from '../google-shared/service-account';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_TTL_SECONDS = 3600;
export const GOOGLE_CHAT_APP_SCOPE = 'https://www.googleapis.com/auth/chat.bot';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Cache by SA client_email — different orgs use different SAs in the BYO
// path, and even the shared app may rotate SAs. The cache is process-local;
// horizontal scale-out tolerates per-worker duplication.
const tokenCache = new Map<string, CachedToken>();

/** Test seam — drop the in-process app token cache. */
export function __clearGoogleChatAppTokenCacheForTests(): void {
  tokenCache.clear();
}

export interface MintAppTokenInput {
  /** Service account JSON key (already-decrypted string). */
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Return a fresh app-level access token for the Chat API, minting one if
 * the cached value is missing or within 60s of expiry.
 */
export async function loadChatAppAccessToken(
  input: MintAppTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const key = parseServiceAccountKey(input.serviceAccountJson);
  const cacheKey = key.client_email;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return {
      accessToken: cached.accessToken,
      expiresAt: new Date(cached.expiresAt),
    };
  }

  const minted = await mintAppAccessToken({ key, fetchImpl: input.fetchImpl });
  tokenCache.set(cacheKey, {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt.getTime() - 60_000,
  });
  return minted;
}

async function mintAppAccessToken(args: {
  key: GoogleServiceAccountKey;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const privateKey = (() => {
    try {
      return createPrivateKey({ key: args.key.private_key, format: 'pem' });
    } catch (cause) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'Service account private_key is not a valid PEM RSA key',
        cause: String(cause),
        fix: 'Re-paste the JSON key downloaded from Google Cloud Console.',
      });
    }
  })();
  const now = Math.floor(Date.now() / 1000);
  // No `sub` claim — app-level auth, the SA acts as itself.
  const jwt = await new SignJWT({ scope: GOOGLE_CHAT_APP_SCOPE })
    .setProtectedHeader({ alg: 'RS256', kid: args.key.private_key_id })
    .setIssuer(args.key.client_email)
    .setAudience(args.key.token_uri ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(privateKey);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetchImpl(args.key.token_uri ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Google Chat app token exchange failed (${res.status}): ${json.error ?? 'unknown'}`,
      cause: json.error_description,
      fix: 'Verify the service account JSON, that the Chat API is enabled on its project, and that the SA has the Chat Bot role.',
    });
  }
  const expiresIn = json.expires_in ?? JWT_TTL_SECONDS;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}
