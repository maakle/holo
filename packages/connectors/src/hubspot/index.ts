import { holoError, ErrorCode } from '@holo/errors';
import type {
  Connector,
  ConnectorTokens,
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  RefreshInput,
  TestConnectionResult,
  SyncContext,
  SyncResult,
  WebhookEnvelope,
  NormalizedWebhookEvent,
} from '../contract';

/**
 * HubSpot OAuth scopes for v0.0 — read-only across the three CRM objects we
 * care about. Tighten or broaden via env in a follow-up if a customer needs
 * line items, tickets, etc.
 */
const HUBSPOT_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.deals.read',
  'crm.objects.companies.read',
];

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const ACCESS_TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v1/access-tokens';

export interface HubspotConnectorOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Override scopes if a downstream install needs additional surface area. */
  scopes?: string[];
}

interface HubspotTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface HubspotAccessTokenInfo {
  hub_id: number;
  hub_domain?: string;
  user?: string;
  app_id: number;
  user_id: number;
  scopes: string[];
  token_type: string;
}

export function createHubspotConnector(opts: HubspotConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const scopes = (opts.scopes ?? HUBSPOT_SCOPES).join(' ');

  return {
    id: 'hubspot',
    displayName: 'HubSpot',

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const params = new URLSearchParams({
        client_id: opts.clientId,
        scope: scopes,
        redirect_uri: input.redirectUri,
        state: input.state,
        response_type: 'code',
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      });
      const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `HubSpot OAuth code exchange failed with status ${res.status}`,
          cause: await res.text(),
          fix: 'Restart the connect flow. Verify HUBSPOT_CONNECTOR_CLIENT_ID/SECRET and the OAuth app callback URL.',
        });
      }
      const json = (await res.json()) as HubspotTokenResponse;
      if (!json.access_token) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'HubSpot token response missing access_token',
          fix: 'Check the HubSpot OAuth app configuration.',
        });
      }
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        scope: scopes,
        expiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000)
          : undefined,
      };
    },

    async refresh(input: RefreshInput): Promise<ConnectorTokens> {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        refresh_token: input.refreshToken,
      });
      const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `HubSpot OAuth refresh failed with status ${res.status}`,
          cause: await res.text(),
          fix: 'User may need to re-authorize HubSpot from /connections.',
        });
      }
      const json = (await res.json()) as HubspotTokenResponse;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? input.refreshToken,
        scope: scopes,
        expiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000)
          : undefined,
      };
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const res = await fetchImpl(`${ACCESS_TOKEN_INFO_URL}/${tokens.accessToken}`, {
        method: 'GET',
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `HubSpot token introspection failed with status ${res.status}`,
          fix: 'Reconnect HubSpot from /connections to get a fresh token.',
        });
      }
      const info = (await res.json()) as HubspotAccessTokenInfo;
      return {
        ok: true,
        externalId: String(info.hub_id),
        name: info.hub_domain ?? `Hub ${info.hub_id}`,
        raw: { hub_id: info.hub_id, hub_domain: info.hub_domain, scopes: info.scopes },
      };
    },

    // Sync engine lands in a follow-up. The worker queue (`apps/worker/src/queues/hubspot.ts`)
    // will call into a `runHubspotSync` similar to Pylon's pattern (paginated REST over
    // contacts / deals / companies, content-hash dedup, embed enqueue). For v0.0 we ship
    // OAuth round-trip + token storage only — `/connections` flips to "Connected ✓" but
    // search returns nothing from HubSpot until ingestion lands.
    async fullSync(_tokens, _ctx: SyncContext): Promise<SyncResult> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot fullSync is not yet implemented',
        fix: 'OAuth round-trip works in v0.0; ingestion lands in a follow-up PR.',
      });
    },

    async incrementalSync(_tokens, _ctx: SyncContext): Promise<SyncResult> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot incrementalSync is not yet implemented',
        fix: 'OAuth round-trip works in v0.0; ingestion lands in a follow-up PR.',
      });
    },

    verifyWebhook(_env: WebhookEnvelope, _secret: string): boolean {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot webhook verification is not yet implemented',
        fix: 'Webhook ingestion lands with the sync engine.',
      });
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot webhook normalization is not yet implemented',
        fix: 'Webhook ingestion lands with the sync engine.',
      });
    },
  };
}
