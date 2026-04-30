import type {
  Connector,
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  ConnectorTokens,
  TestConnectionResult,
  RefreshInput,
  SyncResult,
  WebhookEnvelope,
  NormalizedWebhookEvent,
} from '../contract';
import { holoError, ErrorCode } from '@holo/errors';

export interface GithubConnectorOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export function createGithubConnector(opts: GithubConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'github',
    displayName: 'GitHub',

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', opts.clientId);
      url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('scope', 'repo read:org');
      url.searchParams.set('state', input.state);
      return url.toString();
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const res = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `GitHub OAuth code exchange returned HTTP ${res.status}`,
          fix: 'Verify GITHUB_CONNECTOR_CLIENT_ID/SECRET and the OAuth app callback URL.',
        });
      }
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data['error'] === 'string') {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `GitHub OAuth code exchange returned error: ${data['error']}`,
          cause:
            typeof data['error_description'] === 'string'
              ? data['error_description']
              : undefined,
          fix: 'Restart the connect flow. If it persists, verify the OAuth app config.',
        });
      }
      const accessToken = data['access_token'];
      if (typeof accessToken !== 'string') {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'GitHub OAuth response did not include access_token',
          fix: 'Restart the connect flow.',
        });
      }
      return {
        accessToken,
        refreshToken:
          typeof data['refresh_token'] === 'string' ? data['refresh_token'] : undefined,
        scope: typeof data['scope'] === 'string' ? data['scope'] : undefined,
      };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub token refresh is not implemented in Foundation',
        fix: 'Lands in spec #2 (first connector + ingestion).',
      });
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const res = await fetchImpl('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `GitHub /user check returned HTTP ${res.status}`,
          fix: 'Token may be invalid. Restart the connect flow.',
        });
      }
      const data = (await res.json()) as { id: number; login: string };
      return {
        ok: true,
        externalId: String(data.id),
        name: data.login,
        raw: data as unknown as Record<string, unknown>,
      };
    },

    async fullSync(): Promise<SyncResult> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub fullSync is not implemented in Foundation',
        fix: 'Lands in spec #2.',
      });
    },

    async incrementalSync(): Promise<SyncResult> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub incrementalSync is not implemented in Foundation',
        fix: 'Lands in spec #2.',
      });
    },

    verifyWebhook(_env: WebhookEnvelope, _secret: string): boolean {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub webhook verification is not implemented in Foundation',
        fix: 'Lands in spec #2 if webhooks are enabled.',
      });
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub webhook normalization is not implemented in Foundation',
        fix: 'Lands in spec #2 if webhooks are enabled.',
      });
    },
  };
}
