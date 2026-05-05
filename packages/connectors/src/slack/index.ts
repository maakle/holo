import { holoError, ErrorCode } from '@holo/errors';
import { resolveAllowlist } from '../shared/allowlist';
import { createSlackApiClient, type SlackApiClient } from './api-client';
import { runSlackSync, type EmbedEnqueueFn } from './sync';
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

const SCOPES = [
  'channels:history',
  'channels:read',
  'channels:join',
  'groups:history',
  'groups:read',
  'users:read',
  'team:read',
];

export interface SlackConnectorOptions {
  clientId: string;
  clientSecret: string;
  db?: DB;
  enqueueEmbed?: EmbedEnqueueFn;
  fetchImpl?: typeof fetch;
}

export function createSlackConnector(opts: SlackConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'slack',
    displayName: 'Slack',

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const params = new URLSearchParams({
        client_id: opts.clientId,
        scope: SCOPES.join(','),
        redirect_uri: input.redirectUri,
        state: input.state,
      });
      return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const params = new URLSearchParams({
        code: input.code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: input.redirectUri,
      });
      const res = await fetchImpl('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; access_token?: string; scope?: string };
      if (!json.ok || !json.access_token) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `Slack OAuth code exchange failed: ${json.error ?? 'unknown'}`,
          fix: 'Restart the connect flow. If it persists, verify the Slack app config.',
        });
      }
      return { accessToken: json.access_token, scope: json.scope };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Slack bot tokens do not expire and cannot be refreshed',
        fix: 'Re-install the Slack app to obtain a fresh bot token.',
      });
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const res = await fetchImpl('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const json = (await res.json()) as { ok: boolean; team_id?: string; team?: string };
      if (!json.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'Slack auth.test call failed — token may be invalid',
          fix: 'Re-install the Slack app to obtain a fresh bot token.',
        });
      }
      return {
        ok: true,
        externalId: json.team_id ?? '',
        name: json.team ?? '',
        raw: json as Record<string, unknown>,
      };
    },

    async fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Slack fullSync requires db and enqueueEmbed injected at construction',
          fix: 'Pass db and enqueueEmbed options when calling createSlackConnector().',
        });
      }
      const client = createSlackApiClient(tokens.accessToken, fetchImpl);
      const allowedChannelIds = await resolveSlackChannelIds({
        db: opts.db,
        organizationId: ctx.organizationId,
        client,
      });
      if (allowedChannelIds.length === 0) {
        return { artifactCount: 0, newCursor: new Date() };
      }
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const db = opts.db;
      const result = await runSlackSync({
        client,
        allowedChannelIds,
        cursorMetadata: {},
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
        flushCursor: (metadata) => upsertCursorMetadata(db, ctx.sourceId, ctx.organizationId, metadata),
      });
      return {
        artifactCount: result.artifactCount,
        newCursor: new Date(),
        metadataPatch: result.updatedMetadata,
      };
    },

    async incrementalSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Slack incrementalSync requires db and enqueueEmbed injected at construction',
          fix: 'Pass db and enqueueEmbed options when calling createSlackConnector().',
        });
      }
      const client = createSlackApiClient(tokens.accessToken, fetchImpl);
      const allowedChannelIds = await resolveSlackChannelIds({
        db: opts.db,
        organizationId: ctx.organizationId,
        client,
      });
      if (allowedChannelIds.length === 0) {
        return { artifactCount: 0, newCursor: new Date() };
      }
      const cursor = await loadCursorMetadata(opts.db, ctx.sourceId);
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const db = opts.db;
      const result = await runSlackSync({
        client,
        allowedChannelIds,
        cursorMetadata: cursor,
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueEmbed,
        flushCursor: (metadata) => upsertCursorMetadata(db, ctx.sourceId, ctx.organizationId, metadata),
      });
      return {
        artifactCount: result.artifactCount,
        newCursor: new Date(),
        metadataPatch: result.updatedMetadata,
      };
    },

    verifyWebhook(_env: WebhookEnvelope, _secret: string): boolean {
      return false;
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Slack webhook normalization is deferred to v0.2',
        fix: 'Implement webhook handling in a later release.',
      });
    },
  };
}

/**
 * Resolve which channels to sync. Prefers an explicit allowlist; falls back
 * to "all channels the bot is a member of" when no allowlist is set. The
 * fallback matches GitHub's default-all pattern — it would be redundant
 * friction to require admins to re-pick channels in our UI when they've
 * already curated channel membership in Slack itself (private channels need
 * /invite, public channels are explicitly joined).
 */
async function resolveSlackChannelIds(args: {
  db: DB;
  organizationId: string;
  client: SlackApiClient;
}): Promise<string[]> {
  try {
    const allowlist = await resolveAllowlist({
      db: args.db,
      organizationId: args.organizationId,
      provider: 'slack',
    });
    return allowlist.resolved;
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    const channels = await args.client.listMemberChannels();
    return channels.map((c) => c.id);
  }
}

/**
 * Persist partial cursor metadata mid-sync. Called after each channel
 * completes so an interrupted sync can resume at the channel boundary
 * instead of restarting from oldest=0.
 */
async function upsertCursorMetadata(
  db: DB,
  sourceId: string,
  organizationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { schema } = await import('@holo/db');
  const { eq, and } = await import('drizzle-orm');
  const existing = await db
    .select({ id: schema.connectorCursors.id })
    .from(schema.connectorCursors)
    .where(
      and(
        eq(schema.connectorCursors.sourceId, sourceId),
        eq(schema.connectorCursors.scope, 'sync'),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.connectorCursors)
      .set({ metadata })
      .where(eq(schema.connectorCursors.id, existing[0].id));
  } else {
    await db.insert(schema.connectorCursors).values({
      organizationId,
      sourceId,
      scope: 'sync',
      metadata,
    });
  }
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
