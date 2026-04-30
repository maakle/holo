import { holoError, ErrorCode } from '@holo/errors';
import { createGrainApiClient } from './api-client';
import { runGrainSync, type GrainEmbedEnqueueFn } from './sync';
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
import type { DB } from '@holo/db';

export interface GrainConnectorOptions {
  clientId: string;
  clientSecret: string;
  db?: DB;
  enqueueEmbed?: GrainEmbedEnqueueFn;
  fetchImpl?: typeof fetch;
}

export function createGrainConnector(opts: GrainConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'grain',
    displayName: 'Grain',

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const params = new URLSearchParams({
        client_id: opts.clientId,
        response_type: 'code',
        redirect_uri: input.redirectUri,
        state: input.state,
        scope: 'recordings:read',
      });
      return `https://grain.com/oauth/authorize?${params.toString()}`;
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const res = await fetchImpl('https://api.grain.com/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: input.code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: input.redirectUri,
        }),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `Grain OAuth code exchange failed with status ${res.status}`,
          fix: 'Restart the connect flow. Verify Grain OAuth app credentials.',
        });
      }
      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!json.access_token) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'Grain token response missing access_token',
          fix: 'Check the Grain OAuth app configuration.',
        });
      }
      const expiresAt = json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : undefined;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt,
      };
    },

    async refresh(input: RefreshInput): Promise<ConnectorTokens> {
      const res = await fetchImpl('https://api.grain.com/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: input.refreshToken,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `Grain token refresh failed with status ${res.status}`,
          fix: 'Re-connect Grain via the OAuth flow.',
        });
      }
      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const expiresAt = json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : undefined;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? input.refreshToken,
        expiresAt,
      };
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const client = createGrainApiClient(tokens.accessToken, fetchImpl);
      const { recordings } = await client.listRecordings({});
      return {
        ok: true,
        externalId: 'grain',
        name: 'Grain Workspace',
        raw: { recording_count: recordings.length },
      };
    },

    async fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Grain fullSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createGrainConnector().',
        });
      }
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runGrainSync({
        client: createGrainApiClient(tokens.accessToken, fetchImpl),
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      return { artifactCount: result.artifactCount, newCursor: new Date() };
    },

    async incrementalSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Grain incrementalSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createGrainConnector().',
        });
      }
      const cursor = await loadCursorMetadata(opts.db, ctx.sourceId);
      const updatedAfter = cursor['latest_updated_at'] as string | undefined;
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runGrainSync({
        client: createGrainApiClient(tokens.accessToken, fetchImpl),
        updatedAfter,
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      return { artifactCount: result.artifactCount, newCursor: new Date() };
    },

    verifyWebhook(_env: WebhookEnvelope, _secret: string): boolean {
      return false;
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Grain webhook normalization deferred to v0.2',
        fix: 'Implement webhook handling in a later release.',
      });
    },
  };
}

async function loadCursorMetadata(db: DB, sourceId: string): Promise<Record<string, unknown>> {
  const { schema } = await import('@holo/db');
  const { eq, and } = await import('drizzle-orm');
  const rows = await db
    .select({ metadata: schema.connectorCursors.metadata })
    .from(schema.connectorCursors)
    .where(and(eq(schema.connectorCursors.sourceId, sourceId), eq(schema.connectorCursors.scope, 'sync')))
    .limit(1);
  return rows[0]?.metadata ?? {};
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
