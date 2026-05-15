/**
 * Microsoft Teams sync runner — the worker dispatch that wires
 * `runTenantSync` (from `@holo/connectors/teams/sync`) into the standard
 * `SyncRunner` contract.
 *
 * Why custom rather than `createGenericRunner`:
 *
 *   - Teams auth is env-supplied (`TEAMS_BOT_APP_ID` + `TEAMS_BOT_APP_SECRET`)
 *     and minted per-tenant at sync time. The framework's
 *     `loadTokens(connector_credentials)` path returns an empty token for
 *     Teams' `none()` auth, but the framework also expects the spec's
 *     per-source-row `sync()` to do the work. Teams' "one connection →
 *     many tenants → many channels/chats" doesn't fit that model.
 *   - Tenant enumeration reads `teams_installations` directly — a table
 *     the framework's `ResourceSyncContext` doesn't expose.
 *
 * So this runner orchestrates:
 *   1. Read `teams_installations` for the org.
 *   2. Per tenant: mint a Graph token, call `runTenantSync`, convert
 *      each emitted thread into a `ChunkInsertPayload` via the
 *      `teamsThreadChunker`, batch-enqueue to the embed queue.
 *   3. Aggregate the per-tenant cursors back into one `TeamsCursor`
 *      stored on `connector_cursors.metadata.byTenant[<tenantId>]`.
 *
 * User-directory population is deferred to step 6 (user-subjects
 * derivation). The chunker's fallback chain (`fromDisplayName` → AAD
 * oid → literal `app`) handles missing names today; step 6 will
 * pre-load + cache per-org user maps for richer attribution.
 */
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { schema, type DB } from '@holo/db';
import {
  createTeamsGraphClient,
  parseStoredCursor,
  runTenantSync,
  chunkHash,
  type EmittedThread,
  type ResourceCursor,
  type ResourceEmission,
  type TeamsCursor,
} from '@holo/connectors';
import { teamsThreadChunker, type TeamsMessageInput } from '@holo/chunker';
import { holoError, ErrorCode } from '@holo/errors';
import type { ChunkInsertPayload, EmbedJobPayload } from './embed-insert';
import type { SyncRunner, SyncResult } from './sync-dispatch';
import type { SyncCursor, SyncJobPayload } from './types';

export interface TeamsRunnerDeps {
  db: DB;
  embedQueue: Queue<EmbedJobPayload>;
  /** Shared bot Microsoft App ID (TEAMS_BOT_APP_ID). */
  appId: string;
  /** Shared bot secret (TEAMS_BOT_APP_SECRET). */
  appSecret: string;
  fetchImpl?: typeof fetch;
}

/**
 * Cursor shape persisted in `connector_cursors.metadata` for the Teams
 * source. One key per tenant, each holding that tenant's per-resource
 * `TeamsCursor`. We never combine tenants into one flat map because
 * resource keys (`channel-<teamId>:<channelId>`) collide across tenants
 * — different AAD tenant ids may legitimately share the same channel
 * UUID.
 */
interface PersistedCursor {
  byTenant: Record<string, TeamsCursor>;
}

/**
 * Build a SyncRunner that handles both the `full` (initial) and
 * `incremental` modes. They share an implementation — Teams' delta
 * cursor naturally handles both: an empty cursor means first-run; a
 * populated cursor resumes.
 */
export function createTeamsRunner(deps: TeamsRunnerDeps): SyncRunner {
  const run = async (
    payload: SyncJobPayload,
    cursorIn: SyncCursor | null,
  ): Promise<SyncResult> => {
    if (!deps.appId || !deps.appSecret) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem:
          'TEAMS_BOT_APP_ID / TEAMS_BOT_APP_SECRET are not set on the worker — Teams ingestion cannot mint Graph tokens',
        fix: 'Register the Azure AD app (see docs/connectors/teams-bot.md § Operator setup) and set both env vars on the worker.',
      });
    }

    const persisted = parsePersistedCursor(cursorIn?.metadata);
    const installations = await loadInstallations(deps.db, payload.organizationId);
    if (installations.length === 0) {
      // Nothing to sync — the org has no installed tenants yet. Return
      // a no-op result; the source row's `latest_seen_ts` doesn't move.
      return { artifactCount: 0, newCursor: null, metadataPatch: cursorIn?.metadata ?? {} };
    }

    let artifactCount = 0;
    const newByTenant: Record<string, TeamsCursor> = { ...persisted.byTenant };

    for (const tenant of installations) {
      const graph = createTeamsGraphClient({
        appId: deps.appId,
        appSecret: deps.appSecret,
        tenantId: tenant.tenantId,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });

      const buffered: ChunkInsertPayload[] = [];
      const tenantCursorIn: TeamsCursor = newByTenant[tenant.tenantId] ?? {};

      const { cursor: tenantCursorOut, result: tenantResult } = await runTenantSync({
        graph,
        tenantId: tenant.tenantId,
        cursorIn: tenantCursorIn,
        emit: makeEmitter({
          orgId: payload.organizationId,
          sourceId: payload.sourceId,
          out: buffered,
        }),
      });
      newByTenant[tenant.tenantId] = tenantCursorOut;
      void tenantResult;

      if (buffered.length > 0) {
        await deps.embedQueue.add(
          'embed',
          {
            chunks: buffered,
            organizationId: payload.organizationId,
            sourceArtifactId: buffered[0]!.sourceArtifactId,
          },
          { removeOnComplete: 200, removeOnFail: 200 },
        );
        artifactCount += buffered.length;
      }
    }

    return {
      artifactCount,
      newCursor: new Date(),
      metadataPatch: { byTenant: newByTenant },
    };
  };

  return {
    full: (payload) => run(payload, null),
    incremental: (payload, cursor) => run(payload, cursor),
  };
}

/** Read all rows in `teams_installations` for the given org. */
async function loadInstallations(
  db: DB,
  organizationId: string,
): Promise<Array<{ tenantId: string; tenantDisplayName: string | null }>> {
  return db
    .select({
      tenantId: schema.teamsInstallations.tenantId,
      tenantDisplayName: schema.teamsInstallations.tenantDisplayName,
    })
    .from(schema.teamsInstallations)
    .where(eq(schema.teamsInstallations.organizationId, organizationId));
}

function parsePersistedCursor(raw: unknown): PersistedCursor {
  if (!raw || typeof raw !== 'object') return { byTenant: {} };
  const r = raw as { byTenant?: unknown };
  if (!r.byTenant || typeof r.byTenant !== 'object') return { byTenant: {} };
  const out: Record<string, TeamsCursor> = {};
  for (const [tenantId, rawCursor] of Object.entries(
    r.byTenant as Record<string, unknown>,
  )) {
    out[tenantId] = parseStoredCursor(rawCursor);
  }
  return { byTenant: out };
}

/**
 * Returns an `EmitFn` that converts each thread emission into one or
 * more `ChunkInsertPayload`s via the `teamsThreadChunker` and appends
 * them to `out`. Deletions and `archived` emissions are no-ops in this
 * step — handling them needs the `source_artifacts` lookup that the
 * worker's embed-insert path already owns; we'll wire deletions in
 * step 7 alongside the E2E pass.
 */
function makeEmitter(args: {
  orgId: string;
  sourceId: string;
  out: ChunkInsertPayload[];
}) {
  return async (emission: ResourceEmission): Promise<void> => {
    if (emission.kind !== 'thread') return;
    const chunks = await chunksFromThread(emission.thread, args.orgId, args.sourceId);
    for (const c of chunks) args.out.push(c);
  };
}

/**
 * One thread → potentially multiple chunks (the chunker handles
 * recursive split). The synthetic `sourceArtifactId` matches the
 * chunker's `parentExternalId` so embed-insert can dedupe across
 * re-syncs.
 */
async function chunksFromThread(
  thread: EmittedThread,
  organizationId: string,
  sourceId: string,
): Promise<ChunkInsertPayload[]> {
  const input = buildChunkerInput(thread);
  const sourceArtifactId =
    thread.resourceKind === 'channel'
      ? `teams-thread:${thread.teamId}/${thread.channelId}/${thread.rootMessageId}`
      : `teams-thread:${thread.chatId}/${thread.rootMessageId}`;

  const chunks = await teamsThreadChunker.chunk(input, {
    organizationId,
    sourceId,
    sourceArtifactId,
  });

  return chunks.map((c) => ({
    kind: 'teams-thread',
    content: c.content,
    metadata: c.metadata,
    aclSubjects: c.aclSubjects,
    organizationId,
    sourceId,
    sourceArtifactId,
    provider: 'teams',
    contentHash: chunkHash('teams-thread', c.content),
  }));
}

function buildChunkerInput(thread: EmittedThread) {
  const parent = toChunkerMessage(thread.parent);
  const replies = thread.replies.map(toChunkerMessage);
  const userDirectory = new Map<string, string>();
  // Step 6 will populate this from `user_subjects_cache`. Until then,
  // the chunker's fallback chain hands back AAD oids — readable but
  // not human-friendly.
  return thread.resourceKind === 'channel'
    ? {
        resourceKind: 'channel' as const,
        teamId: thread.teamId,
        teamDisplayName: thread.teamDisplayName,
        channelId: thread.channelId,
        channelDisplayName: thread.channelDisplayName,
        channelMembershipType: thread.channelMembershipType,
        rootMessageId: thread.rootMessageId,
        createdDateTime: thread.createdDateTime,
        ...(thread.webUrl !== null ? { webUrl: thread.webUrl } : {}),
        parent,
        replies,
        participantAadObjectIds: thread.participantAadObjectIds,
        userDirectory,
      }
    : {
        resourceKind: 'chat' as const,
        chatId: thread.chatId,
        chatTopic: thread.chatTopic,
        chatType: thread.chatType,
        rootMessageId: thread.rootMessageId,
        createdDateTime: thread.createdDateTime,
        ...(thread.webUrl !== null ? { webUrl: thread.webUrl } : {}),
        parent,
        replies,
        participantAadObjectIds: thread.participantAadObjectIds,
        userDirectory,
      };
}

function toChunkerMessage(
  m: EmittedThread['parent'],
): TeamsMessageInput {
  const fromUserId = m.from?.user?.id;
  const fromDisplayName = m.from?.user?.displayName;
  return {
    id: m.id,
    createdDateTime: m.createdDateTime,
    ...(fromUserId !== undefined ? { fromUserId } : {}),
    ...(fromDisplayName !== undefined ? { fromDisplayName } : {}),
    bodyContentType: m.body?.contentType ?? 'text',
    bodyContent: m.body?.content ?? '',
  };
}

// Surface helpers for tests.
export const __testing = {
  chunksFromThread,
  parsePersistedCursor,
};
// Avoid unused-import warning for `ResourceCursor` (kept in scope for
// readers of this file's types).
void (null as unknown as ResourceCursor);
