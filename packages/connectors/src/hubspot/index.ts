import { holoError, ErrorCode } from '@holo/errors';
import type { DB } from '@holo/db';
import { createHubspotApiClient } from './api-client';
import {
  runHubspotSync,
  type HubspotCursor,
  type HubspotEmbedEnqueueFn,
} from './sync';
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
 * HubSpot OAuth scopes — read-only across the three CRM objects plus the
 * engagement timelines (notes/calls/emails/meetings/tasks) we ingest as
 * separate chunks per record.
 */
const HUBSPOT_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.deals.read',
  'crm.objects.companies.read',
  'sales-email-read',
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
  /** Required when the worker invokes fullSync/incrementalSync. */
  db?: DB;
  enqueueEmbed?: HubspotEmbedEnqueueFn;
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

    async fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'HubSpot fullSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createHubspotConnector().',
        });
      }
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runHubspotSync({
        client: createHubspotApiClient(tokens.accessToken, fetchImpl),
        cursor: {},
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      await persistHubspotCursor(opts.db, ctx.organizationId, ctx.sourceId, result.newCursor);
      return { artifactCount: result.artifactCount, newCursor: new Date() };
    },

    async incrementalSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'HubSpot incrementalSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createHubspotConnector().',
        });
      }
      const cursor = await loadHubspotCursor(opts.db, ctx.sourceId);
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runHubspotSync({
        client: createHubspotApiClient(tokens.accessToken, fetchImpl),
        cursor,
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      await persistHubspotCursor(opts.db, ctx.organizationId, ctx.sourceId, result.newCursor);
      return { artifactCount: result.artifactCount, newCursor: new Date() };
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

async function loadHubspotCursor(db: DB, sourceId: string): Promise<HubspotCursor> {
  const { schema } = await import('@holo/db');
  const { eq, and } = await import('drizzle-orm');
  const rows = await db
    .select({ metadata: schema.connectorCursors.metadata })
    .from(schema.connectorCursors)
    .where(and(eq(schema.connectorCursors.sourceId, sourceId), eq(schema.connectorCursors.scope, 'sync')))
    .limit(1);
  const meta = (rows[0]?.metadata ?? {}) as Record<string, unknown>;
  const out: HubspotCursor = {};
  if (typeof meta['contacts'] === 'string') out.contacts = meta['contacts'] as string;
  if (typeof meta['deals'] === 'string') out.deals = meta['deals'] as string;
  if (typeof meta['companies'] === 'string') out.companies = meta['companies'] as string;
  return out;
}

async function persistHubspotCursor(
  db: DB,
  organizationId: string,
  sourceId: string,
  cursor: HubspotCursor,
): Promise<void> {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    INSERT INTO connector_cursors (organization_id, source_id, scope, metadata, last_run_at, last_status)
    VALUES (${organizationId}, ${sourceId}, 'sync', ${JSON.stringify(cursor)}::jsonb, now(), 'ok')
    ON CONFLICT (source_id, scope) DO UPDATE SET
      metadata = EXCLUDED.metadata,
      last_run_at = now(),
      last_status = 'ok'
  `);
}

async function loadExistingHashes(db: DB, organizationId: string): Promise<Set<string>> {
  const { schema } = await import('@holo/db');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ contentHash: schema.chunks.contentHash })
    .from(schema.chunks)
    .where(eq(schema.chunks.organizationId, organizationId));
  return new Set(rows.map((r) => r.contentHash));
}
