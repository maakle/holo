import { holoError, ErrorCode } from '@holo/errors';
import { resolveAllowlist } from '../shared/allowlist';
import { createNotionApiClient } from './api-client';
import { runNotionSync, type NotionEmbedEnqueueFn } from './sync';
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

export interface NotionConnectorOptions {
  db?: DB;
  enqueueEmbed?: NotionEmbedEnqueueFn;
  fetchImpl?: typeof fetch;
}

export function createNotionConnector(opts: NotionConnectorOptions = {}): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'notion',
    displayName: 'Notion',

    buildAuthorizeUrl(_input: BuildAuthorizeUrlInput): string {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Notion uses integration tokens, not OAuth. No authorize URL.',
        fix: 'Copy the integration token from https://www.notion.so/my-integrations and use testConnection() to verify it.',
      });
    },

    async exchangeCode(_input: ExchangeCodeInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Notion uses integration tokens, not OAuth code exchange.',
        fix: 'Pass the integration token directly via testConnection().',
      });
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Notion integration tokens do not expire.',
        fix: 'Nothing to do — integration tokens are permanent.',
      });
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const client = createNotionApiClient(tokens.accessToken, fetchImpl);
      try {
        const me = await client.usersMe();
        return {
          ok: true,
          externalId: me.id,
          name: me.workspace_name ?? me.name ?? me.id,
          raw: me as Record<string, unknown>,
        };
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          throw holoError({
            code: ErrorCode.HOLO_NOTION_TOKEN_INVALID,
            problem: 'Notion returned 401 — integration token is invalid',
            fix: 'Verify the token at https://www.notion.so/my-integrations and update it.',
          });
        }
        throw err;
      }
    },

    async fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Notion fullSync requires db and enqueueEmbed injected at construction',
          fix: 'Pass db and enqueueEmbed options when calling createNotionConnector().',
        });
      }
      const allowlist = await resolveAllowlist({
        db: opts.db,
        organizationId: ctx.organizationId,
        provider: 'notion',
      });
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runNotionSync({
        client: createNotionApiClient(tokens.accessToken, fetchImpl),
        allowedPageIds: allowlist.resolved,
        cursorMetadata: {},
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
          problem: 'Notion incrementalSync requires db and enqueueEmbed injected at construction',
          fix: 'Pass db and enqueueEmbed options when calling createNotionConnector().',
        });
      }
      const allowlist = await resolveAllowlist({
        db: opts.db,
        organizationId: ctx.organizationId,
        provider: 'notion',
      });
      const cursor = await loadCursorMetadata(opts.db, ctx.sourceId);
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const result = await runNotionSync({
        client: createNotionApiClient(tokens.accessToken, fetchImpl),
        allowedPageIds: allowlist.resolved,
        cursorMetadata: cursor,
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
        problem: 'Notion webhooks are deferred to v0.2',
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
