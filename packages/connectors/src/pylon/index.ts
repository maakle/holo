import { holoError, ErrorCode } from '@holo/errors';
import { createPylonApiClient } from './api-client';
import { runPylonSync, type PylonEmbedEnqueueFn } from './sync';
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

export interface PylonConnectorOptions {
  apiKey: string;
  db?: DB;
  enqueueEmbed?: PylonEmbedEnqueueFn;
  fetchImpl?: typeof fetch;
}

export function createPylonConnector(opts: PylonConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'pylon',
    displayName: 'Pylon',

    buildAuthorizeUrl(_input: BuildAuthorizeUrlInput): string {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Pylon uses API keys, not OAuth — buildAuthorizeUrl is not applicable.',
        fix: 'Generate an API key in the Pylon dashboard and pass it as apiKey.',
      });
    },

    async exchangeCode(_input: ExchangeCodeInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Pylon uses API keys, not OAuth — exchangeCode is not applicable.',
        fix: 'Generate an API key in the Pylon dashboard and pass it as apiKey.',
      });
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Pylon uses static API keys, not OAuth — refresh is not applicable.',
        fix: 'Pylon API keys are long-lived and do not require refresh.',
      });
    },

    async testConnection(_tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const client = createPylonApiClient(opts.apiKey, fetchImpl);
      const data = await client.testConnection();
      return {
        ok: true,
        externalId: data.id,
        name: data.name,
        raw: { org_id: data.id, org_name: data.name },
      };
    },

    async fullSync(_tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Pylon fullSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createPylonConnector().',
        });
      }
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runPylonSync({
        client: createPylonApiClient(opts.apiKey, fetchImpl),
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
      });
      return { artifactCount: result.artifactCount, newCursor: new Date() };
    },

    async incrementalSync(_tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Pylon incrementalSync requires db and enqueueEmbed',
          fix: 'Pass db and enqueueEmbed when calling createPylonConnector().',
        });
      }
      const cursor = await loadCursorMetadata(opts.db, ctx.sourceId);
      const updatedAfter = cursor['latest_updated_at'] as string | undefined;
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runPylonSync({
        client: createPylonApiClient(opts.apiKey, fetchImpl),
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
        problem: 'Pylon webhook normalization deferred to v0.2',
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
