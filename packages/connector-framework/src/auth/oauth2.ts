import { ErrorCode, holoError } from '@holo/errors';
import type { ConnectorTokens } from '../types';
import type {
  AuthStrategy,
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  RefreshInput,
} from './types';

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: ReadonlyArray<string>;
  /** Whether the provider issues refresh tokens. */
  refreshable: boolean;
  /** Comma vs space; Slack uses comma, most use space. */
  scopeSeparator?: ' ' | ',';
  /** 'Bearer' for most providers; some use a custom scheme. */
  authScheme?: string;
  /** Slack-style: returns `{ ok: false, error }` on auth.test instead of HTTP error. */
  okPredicate?: (json: unknown) => boolean;
  /** Override token-response parsing for non-RFC-6749 providers. */
  parseTokenResponse?: (json: unknown) => ConnectorTokens;
  fetchImpl?: typeof fetch;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  ok?: boolean;
  error?: string;
}

function defaultParseTokenResponse(json: unknown): ConnectorTokens {
  const r = json as RawTokenResponse;
  if (!r.access_token) {
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `OAuth token response missing access_token: ${r.error ?? 'unknown'}`,
      fix: 'Restart the connect flow. If it persists, verify the OAuth app config.',
    });
  }
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    scope: r.scope,
    expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : undefined,
  };
}

export function oauth2(config: OAuth2Config): AuthStrategy {
  const fetchImpl = config.fetchImpl ?? fetch;
  const scopeSeparator = config.scopeSeparator ?? ' ';
  const scheme = config.authScheme ?? 'Bearer';
  const parseTokens = config.parseTokenResponse ?? defaultParseTokenResponse;

  async function exchange(form: URLSearchParams): Promise<ConnectorTokens> {
    const res = await fetchImpl(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json = (await res.json()) as RawTokenResponse;
    if (!res.ok && (config.okPredicate ? !config.okPredicate(json) : true)) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `OAuth token endpoint returned ${res.status}: ${json.error ?? ''}`,
        fix: 'Restart the connect flow. If it persists, verify the OAuth app config.',
      });
    }
    if (config.okPredicate && !config.okPredicate(json)) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `OAuth token exchange failed: ${json.error ?? 'unknown'}`,
        fix: 'Restart the connect flow.',
      });
    }
    return parseTokens(json);
  }

  return {
    kind: 'oauth2',
    refreshable: config.refreshable,

    authHeader(tokens) {
      return { name: 'Authorization', value: `${scheme} ${tokens.accessToken}` };
    },

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const scopes = input.scopes ?? config.scopes;
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        state: input.state,
        response_type: 'code',
        scope: scopes.join(scopeSeparator),
      });
      const sep = config.authorizeUrl.includes('?') ? '&' : '?';
      return `${config.authorizeUrl}${sep}${params.toString()}`;
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      });
      return exchange(form);
    },

    async refresh(input: RefreshInput): Promise<ConnectorTokens> {
      if (!config.refreshable) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'This OAuth provider does not issue refresh tokens',
          fix: 'Re-connect the integration to obtain a fresh token.',
        });
      }
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      });
      return exchange(form);
    },
  };
}
