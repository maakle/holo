/**
 * Google service-account auth helper for googledrive + google-chat.
 *
 * Mints short-lived (1 hour) delegated access tokens via Google's OAuth 2.0
 * JWT bearer flow:
 *   1. Decrypt the stored JSON key for (org, provider).
 *   2. Sign a JWT (RS256) asserting the SA, the impersonated Workspace user,
 *      the requested scopes, and a 1-hour expiry.
 *   3. POST it to https://oauth2.googleapis.com/token with
 *      grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer.
 *   4. Cache the access token in-process for ~50 minutes so repeated syncs
 *      within the same worker incarnation don't re-mint.
 *
 * Mirrors loadGithubInstallationToken's shape: bridge calls in, gets back
 * a fresh token, doesn't have to know about the JWT dance.
 */
import { SignJWT } from 'jose';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { GOOGLE_CHAT_APP_SCOPES, GOOGLE_SERVICE_ACCOUNT_SCOPES } from '@holo/sync-providers';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_TTL_SECONDS = 3600; // Google caps at 1 hour

export const GOOGLE_SERVICE_ACCOUNT_PROVIDERS = ['googledrive', 'google-chat'] as const;
export type GoogleServiceAccountProvider = (typeof GOOGLE_SERVICE_ACCOUNT_PROVIDERS)[number];

export function isGoogleServiceAccountProvider(
  provider: string,
): provider is GoogleServiceAccountProvider {
  return (GOOGLE_SERVICE_ACCOUNT_PROVIDERS as readonly string[]).includes(provider);
}

export function googleServiceAccountScopes(
  provider: GoogleServiceAccountProvider,
): ReadonlyArray<string> {
  return GOOGLE_SERVICE_ACCOUNT_SCOPES[provider];
}

/**
 * Shape of a Google service account JSON key. Pulled from
 * https://cloud.google.com/iam/docs/keys-create-delete — we validate the
 * subset we actually need so a malformed paste fails at install time, not
 * mid-sync.
 */
export interface GoogleServiceAccountKey {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
  [key: string]: unknown;
}

export function parseServiceAccountKey(raw: string): GoogleServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Service account key is not valid JSON',
      cause: String(cause),
      fix: 'Paste the entire JSON key file downloaded from Google Cloud Console (Service Accounts → Keys → Add key → JSON).',
    });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Service account key must be a JSON object',
      fix: 'Paste the entire JSON key file from Google Cloud Console.',
    });
  }
  const obj = parsed as Record<string, unknown>;
  const required = ['type', 'private_key', 'client_email', 'client_id'];
  for (const f of required) {
    if (typeof obj[f] !== 'string' || !obj[f]) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Service account key is missing required field "${f}"`,
        fix: 'Re-download the JSON key from Google Cloud Console — partial pastes are missing fields.',
      });
    }
  }
  if (obj.type !== 'service_account') {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Expected "type": "service_account", got "${String(obj.type)}"`,
      fix: 'Use a service account key (Cloud Console → IAM → Service Accounts), not an OAuth client or user credential.',
    });
  }
  return obj as GoogleServiceAccountKey;
}

function loadPrivateKey(pem: string): KeyObject {
  try {
    return createPrivateKey({ key: pem, format: 'pem' });
  } catch (cause) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Service account private_key is not a valid PEM RSA key',
      cause: String(cause),
      fix: 'Re-download the JSON key from Google Cloud Console — the private_key field may have been truncated or re-encoded.',
    });
  }
}

interface MintArgs {
  key: GoogleServiceAccountKey;
  impersonationEmail: string;
  scopes: ReadonlyArray<string>;
  fetchImpl?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Sign a JWT with the SA private key + exchange it at Google's token endpoint
 * for a delegated access token. Bypasses cache — callers should prefer
 * loadGoogleServiceAccountToken which caches for ~50 minutes.
 */
export async function mintDelegatedAccessToken(
  args: MintArgs,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const key = loadPrivateKey(args.key.private_key);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: args.scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'RS256', kid: args.key.private_key_id })
    .setIssuer(args.key.client_email)
    .setSubject(args.impersonationEmail)
    .setAudience(args.key.token_uri ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(key);

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
    // Google returns 400 with `invalid_grant` when DWD isn't set up for the
    // SA's client_id, when the impersonation email isn't a real Workspace
    // user, or when the SA itself is disabled. Surface the original error so
    // admins know which knob to turn.
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Google JWT bearer exchange failed (${res.status}): ${json.error ?? 'unknown'}`,
      cause: json.error_description,
      fix:
        json.error === 'invalid_grant'
          ? 'Verify that domain-wide delegation is configured in Google Workspace Admin Console for the service account\'s client ID, that the requested scopes are listed there, and that the impersonation email is an active Workspace user.'
          : 'Check the service account JSON key, impersonation email, and Google Workspace DWD configuration.',
    });
  }
  const expiresIn = json.expires_in ?? JWT_TTL_SECONDS;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

interface MintAppArgs {
  key: GoogleServiceAccountKey;
  scopes: ReadonlyArray<string>;
  fetchImpl?: typeof fetch;
}

/**
 * App-level token mint: sign a JWT with the SA private key but omit the `sub`
 * (impersonation) claim. The resulting token authenticates the SA as itself,
 * not as a Workspace user. Used by Google Chat's bot-in-space mode where reads
 * are scoped to spaces the bot has joined, not to an impersonated user's view.
 *
 * Bypasses cache — callers should prefer loadGoogleServiceAccountToken.
 */
export async function mintAppAccessToken(
  args: MintAppArgs,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const key = loadPrivateKey(args.key.private_key);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: args.scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'RS256', kid: args.key.private_key_id })
    .setIssuer(args.key.client_email)
    // Deliberately no .setSubject() — app-level auth, the SA acts as itself.
    .setAudience(args.key.token_uri ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(key);

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
      problem: `Google JWT bearer exchange (app mode) failed (${res.status}): ${json.error ?? 'unknown'}`,
      cause: json.error_description,
      fix: 'Verify the service account JSON key, that the Chat API is enabled on its project, and that the SA has the Chat Bot role.',
    });
  }
  const expiresIn = json.expires_in ?? JWT_TTL_SECONDS;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(orgId: string, provider: string): string {
  return `${orgId}::${provider}`;
}

/** Test seam — clear the in-process token cache. */
export function __clearGoogleServiceAccountTokenCacheForTests(): void {
  tokenCache.clear();
}

/**
 * Invalidate the cached delegated token for one (org, provider) pair. Call
 * after upserting the SA row so the next `loadGoogleServiceAccountToken`
 * mints a fresh token against the current impersonationEmail / key — rather
 * than handing back a token bound to the previous values for up to ~50
 * minutes.
 */
export function invalidateGoogleServiceAccountTokenCache(
  organizationId: string,
  provider: GoogleServiceAccountProvider,
): void {
  tokenCache.delete(cacheKey(organizationId, provider));
}

export interface LoadGoogleServiceAccountTokenInput {
  db: DB;
  organizationId: string;
  provider: GoogleServiceAccountProvider;
  fetchImpl?: typeof fetch;
}

/**
 * Look up the SA row for (org, provider), mint (or reuse a cached) delegated
 * access token, and return it. Throws HOLO_AUTH_NO_SESSION if the org hasn't
 * connected this provider via the service-account flow.
 */
export async function loadGoogleServiceAccountToken(
  input: LoadGoogleServiceAccountTokenInput,
): Promise<{ accessToken: string; expiresAt: Date; impersonationEmail: string | null }> {
  const cached = tokenCache.get(cacheKey(input.organizationId, input.provider));
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    // We don't carry impersonationEmail through the cache — re-fetch it on a
    // miss only. The cache hit path returns the token; impersonation email
    // matters only at mint time and for display. App-mode rows have no
    // impersonation email at all (null).
    const rows = await input.db
      .select({ impersonationEmail: schema.connectorServiceAccounts.impersonationEmail })
      .from(schema.connectorServiceAccounts)
      .where(
        and(
          eq(schema.connectorServiceAccounts.organizationId, input.organizationId),
          eq(schema.connectorServiceAccounts.provider, input.provider),
          eq(schema.connectorServiceAccounts.status, 'active'),
        ),
      )
      .limit(1);
    return {
      accessToken: cached.accessToken,
      expiresAt: new Date(cached.expiresAt),
      impersonationEmail: rows[0]?.impersonationEmail ?? null,
    };
  }

  const rows = await input.db
    .select({
      keyJson: schema.connectorServiceAccounts.keyJson,
      impersonationEmail: schema.connectorServiceAccounts.impersonationEmail,
      authMode: schema.connectorServiceAccounts.authMode,
    })
    .from(schema.connectorServiceAccounts)
    .where(
      and(
        eq(schema.connectorServiceAccounts.organizationId, input.organizationId),
        eq(schema.connectorServiceAccounts.provider, input.provider),
        eq(schema.connectorServiceAccounts.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: `No active ${input.provider} service account for organization ${input.organizationId}`,
      fix: `Connect ${input.provider} via the service-account wizard in /connections before triggering a sync.`,
    });
  }

  const key = parseServiceAccountKey(row.keyJson);

  // App-mode is only meaningful for Chat (Drive needs per-user impersonation
  // for drive.readonly to surface a user's files). Reject the combination
  // explicitly rather than silently producing an unusable token.
  if (row.authMode === 'app' && input.provider !== 'google-chat') {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `auth_mode='app' is only supported for google-chat, got '${input.provider}'`,
      fix: 'Use auth_mode=dwd for googledrive; app-level auth requires per-user impersonation for Drive scopes.',
    });
  }

  const minted =
    row.authMode === 'app'
      ? await mintAppAccessToken({
          key,
          scopes: GOOGLE_CHAT_APP_SCOPES,
          fetchImpl: input.fetchImpl,
        })
      : await mintDelegatedAccessToken({
          key,
          // dwd mode requires an impersonation email; guard against a row that
          // was inserted before the schema relaxed the NOT NULL constraint and
          // somehow ended up with NULL despite dwd mode.
          impersonationEmail: requireImpersonationEmail(row.impersonationEmail, input.provider),
          scopes: googleServiceAccountScopes(input.provider),
          fetchImpl: input.fetchImpl,
        });

  // Cache 60s before actual expiry so a long-running call doesn't catch a
  // token that expires mid-flight.
  tokenCache.set(cacheKey(input.organizationId, input.provider), {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt.getTime() - 60_000,
  });

  return {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt,
    impersonationEmail: row.impersonationEmail,
  };
}

function requireImpersonationEmail(
  value: string | null,
  provider: GoogleServiceAccountProvider,
): string {
  if (!value) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `auth_mode='dwd' requires impersonation_email but the ${provider} SA row has none`,
      fix: 'Re-run the service-account wizard or set the impersonation email directly on the SA row.',
    });
  }
  return value;
}
