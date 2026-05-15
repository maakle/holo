/**
 * Microsoft access token mint, shared by the bot (Bot Framework calls)
 * and the ingestion connector (Microsoft Graph calls).
 *
 * Both surfaces use the same Azure AD app registration
 * (`TEAMS_BOT_APP_ID` + `TEAMS_BOT_APP_SECRET`) but they hit different
 * Microsoft endpoints:
 *
 *   bot:        POST https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
 *               scope=https://api.botframework.com/.default
 *               (the special `botframework.com` "tenant" routes all
 *                multi-tenant Bot Framework calls.)
 *
 *   ingestion:  POST https://login.microsoftonline.com/<customer-tenant-id>/oauth2/v2.0/token
 *               scope=https://graph.microsoft.com/.default
 *               (per-customer-tenant — Graph tokens are bound to one
 *                tenant; to call Graph for tenant B you mint against
 *                tenant B's endpoint.)
 *
 * Tokens expire after ~1h; we cache in-process for ~55 min, keyed by
 * (appId, tenantId, scope) so the bot path and each customer tenant
 * keep separate tokens.
 */
import { holoError, ErrorCode } from '@holo/errors';

const TOKEN_URL_BASE = 'https://login.microsoftonline.com';

/** Bot Framework tenant alias — special multi-tenant endpoint. */
const BOT_FRAMEWORK_TENANT = 'botframework.com';

/** Scope for Bot Framework outbound (sending Activity messages). */
export const TEAMS_BOT_SCOPE = 'https://api.botframework.com/.default';

/** Scope for Microsoft Graph (reading channels, chats, members, etc.). */
export const TEAMS_GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Cache key is `${appId}:${tenantId}:${scope}` so:
 *  - bot tokens for app A live separately from Graph tokens for app A
 *  - Graph tokens for tenant X live separately from tenant Y
 *  - BYO orgs with different app secrets get separate cache entries
 */
const tokenCache = new Map<string, CachedToken>();

/** Test seam — drop the in-process token cache. */
export function __clearTeamsBotTokenCacheForTests(): void {
  tokenCache.clear();
}

export interface MintTeamsTokenInput {
  appId: string;
  appSecret: string;
  /**
   * Tenant to mint against. Default: `botframework.com` for backwards
   * compat with bot callers. For Graph ingestion pass the customer's
   * Azure AD tenant GUID.
   */
  tenantId?: string;
  /**
   * OAuth scope. Default: bot scope (Bot Framework outbound).
   * For Graph access pass `TEAMS_GRAPH_SCOPE`.
   */
  scope?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Alias kept for backwards compat with the bot's existing call sites.
 * @deprecated Prefer `MintTeamsTokenInput`. Both names point at the
 * same shape; this alias will be removed when the bot is migrated to
 * the new name.
 */
export type MintTeamsBotTokenInput = MintTeamsTokenInput;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Return a fresh access token. Defaults preserve the bot's existing
 * behaviour (no scope/tenant params → Bot Framework tenant + bot
 * scope). Graph callers pass `tenantId` (customer tenant GUID) and
 * `scope: TEAMS_GRAPH_SCOPE`.
 *
 * Mints on cache miss or within 60s of expiry.
 */
export async function loadTeamsBotAccessToken(
  input: MintTeamsTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const tenantId = input.tenantId ?? BOT_FRAMEWORK_TENANT;
  const scope = input.scope ?? TEAMS_BOT_SCOPE;
  const cacheKey = `${input.appId}:${tenantId}:${scope}`;

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return {
      accessToken: cached.accessToken,
      expiresAt: new Date(cached.expiresAt),
    };
  }
  const minted = await mintAccessToken(input, tenantId, scope);
  tokenCache.set(cacheKey, {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt.getTime() - 60_000,
  });
  return minted;
}

async function mintAccessToken(
  input: MintTeamsTokenInput,
  tenantId: string,
  scope: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.appId,
    client_secret: input.appSecret,
    scope,
  });
  const url = `${TOKEN_URL_BASE}/${tenantId}/oauth2/v2.0/token`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    const isGraph = scope === TEAMS_GRAPH_SCOPE;
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Microsoft token exchange failed (${res.status}, tenant=${tenantId}, scope=${scope}): ${json.error ?? 'unknown'}`,
      cause: json.error_description,
      fix: isGraph
        ? 'Verify the customer tenant has granted Resource-Specific Consent permissions to the bot (re-sideload holo-bot.zip if perms were added recently).'
        : 'Verify TEAMS_BOT_APP_ID and TEAMS_BOT_APP_SECRET match the Azure AD app registration, and the app has the Microsoft Bot identity permission.',
    });
  }
  const expiresIn = json.expires_in ?? 3600;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}
