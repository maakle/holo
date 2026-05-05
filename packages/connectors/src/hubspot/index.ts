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

export interface HubspotConnectorOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Required when the worker invokes fullSync/incrementalSync. */
  db?: DB;
  enqueueEmbed?: HubspotEmbedEnqueueFn;
}

export function createHubspotConnector(opts: HubspotConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'hubspot',
    displayName: 'HubSpot',

    buildAuthorizeUrl(_input: BuildAuthorizeUrlInput): string {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot uses Service Keys, not OAuth — buildAuthorizeUrl is not applicable.',
        fix: 'Generate a Service Key in your HubSpot developer account and pass it as apiKey.',
      });
    },

    async exchangeCode(_input: ExchangeCodeInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot uses Service Keys, not OAuth — exchangeCode is not applicable.',
        fix: 'Generate a Service Key in your HubSpot developer account and pass it as apiKey.',
      });
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot Service Keys are long-lived — refresh is not applicable.',
        fix: 'Service Keys do not expire; rotate manually in the HubSpot developer dashboard if needed.',
      });
    },

    async testConnection(_tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const client = createHubspotApiClient(opts.apiKey, fetchImpl);
      const data = await client.testConnection();
      return {
        ok: true,
        externalId: data.id,
        name: data.name,
        raw: { hub_id: data.id, hub_name: data.name },
      };
    },

    async fullSync(_tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'HubSpot fullSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createHubspotConnector().',
        });
      }
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runHubspotSync({
        client: createHubspotApiClient(opts.apiKey, fetchImpl),
        cursor: {},
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      await persistHubspotCursor(opts.db, ctx.organizationId, ctx.sourceId, result.newCursor);
      return { artifactCount: result.artifactCount, newCursor: new Date() };
    },

    async incrementalSync(_tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
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
        client: createHubspotApiClient(opts.apiKey, fetchImpl),
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
      return false;
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot Service Keys cannot authenticate webhooks',
        fix: 'Holo polls HubSpot via incremental sync; webhook ingestion would require a full OAuth app.',
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
