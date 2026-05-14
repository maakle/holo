/**
 * Microsoft Teams Bot Framework outbound access token mint.
 *
 * The bot authenticates to the Bot Connector API with a
 * `client_credentials` grant against Microsoft's identity platform:
 *
 *   POST https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
 *     grant_type=client_credentials
 *     client_id=<bot Microsoft App ID>
 *     client_secret=<bot client secret>
 *     scope=https://api.botframework.com/.default
 *
 * Unlike Google Chat (where we sign a self-issued JWT and exchange it),
 * Microsoft's bot identity platform is a stock OAuth2 client-credentials
 * exchange. Tokens expire after ~1h; we cache in-process for ~55 min,
 * keyed by App ID so BYO orgs and the shared Holo bot don't collide.
 */
import { holoError, ErrorCode } from '@holo/errors';

const TOKEN_URL =
  'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
export const TEAMS_BOT_SCOPE = 'https://api.botframework.com/.default';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Test seam — drop the in-process bot token cache. */
export function __clearTeamsBotTokenCacheForTests(): void {
  tokenCache.clear();
}

export interface MintTeamsBotTokenInput {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Return a fresh outbound access token, minting one when the cached value
 * is missing or within 60s of expiry.
 */
export async function loadTeamsBotAccessToken(
  input: MintTeamsBotTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const cached = tokenCache.get(input.appId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return {
      accessToken: cached.accessToken,
      expiresAt: new Date(cached.expiresAt),
    };
  }
  const minted = await mintAccessToken(input);
  tokenCache.set(input.appId, {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt.getTime() - 60_000,
  });
  return minted;
}

async function mintAccessToken(
  input: MintTeamsBotTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.appId,
    client_secret: input.appSecret,
    scope: TEAMS_BOT_SCOPE,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Teams bot token exchange failed (${res.status}): ${json.error ?? 'unknown'}`,
      cause: json.error_description,
      fix: 'Verify the bot Microsoft App ID and client secret match the Azure AD app registration, and that the app has the Microsoft Bot identity permission.',
    });
  }
  const expiresIn = json.expires_in ?? 3600;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}
