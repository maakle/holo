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
import { and, eq, inArray } from 'drizzle-orm';
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
      const deletions: Array<{ externalId: string }> = [];
      const tenantCursorIn: TeamsCursor = newByTenant[tenant.tenantId] ?? {};

      const { cursor: tenantCursorOut, result: tenantResult } = await runTenantSync({
        graph,
        tenantId: tenant.tenantId,
        cursorIn: tenantCursorIn,
        emit: makeEmitter({
          orgId: payload.organizationId,
          sourceId: payload.sourceId,
          out: buffered,
          deletions,
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

      if (deletions.length > 0) {
        await softDeleteArtifacts(
          deps.db,
          payload.organizationId,
          deletions.map((d) => d.externalId),
        );
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
 * more `ChunkInsertPayload`s via the `teamsThreadChunker`. Deletion
 * emissions are translated to synthetic `externalId`s and accumulated
 * for batched soft-delete after the per-tenant sync completes.
 *
 * Why a buffer rather than emit-time deletes: keeping the per-tenant
 * sync transactional-ish — if `runTenantSync` throws partway through,
 * we don't want a half-applied delete + partial chunk insert.
 */
function makeEmitter(args: {
  orgId: string;
  sourceId: string;
  out: ChunkInsertPayload[];
  deletions: Array<{ externalId: string }>;
}) {
  return async (emission: ResourceEmission): Promise<void> => {
    if (emission.kind === 'thread') {
      const chunks = await chunksFromThread(
        emission.thread,
        args.orgId,
        args.sourceId,
      );
      for (const c of chunks) args.out.push(c);
      return;
    }
    if (emission.kind === 'deletion') {
      const externalId = externalIdForDeletion(emission.deletion);
      if (externalId) args.deletions.push({ externalId });
      return;
    }
    // `archived` emissions: noop here. The cursor entry transitions to
    // `phase: 'archived'` inside `runTenantSync`, which is enough to
    // stop further sync runs against the resource. Existing chunks
    // stay retrievable until a separate purge.
  };
}

/**
 * Convert a deletion emission to the synthetic `external_id` we wrote
 * for the corresponding `source_artifacts` row. Returns null if the
 * cursor key is malformed (defensive — shouldn't happen since the
 * emitter set it).
 *
 * Channel cursor key:  `channel-<teamId>:<channelId>` →
 *                       `teams-thread:<teamId>/<channelId>/<rootMessageId>`
 * Chat cursor key:     `chat-<chatId>` →
 *                       `teams-thread:<chatId>/<rootMessageId>`
 *
 * If the deleted message id is a thread *reply* (not a root), the
 * lookup misses — `source_artifacts` only has rows keyed by root id.
 * That's the right behavior: a reply deletion just means the next sync
 * will re-emit the thread without it; the orphan content lingers in
 * the chunk until then. v2 can add reply-level granularity if needed.
 */
function externalIdForDeletion(d: {
  resourceCursorKey: string;
  rootMessageId: string;
}): string | null {
  if (d.resourceCursorKey.startsWith('channel-')) {
    const rest = d.resourceCursorKey.slice('channel-'.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return null;
    const teamId = rest.slice(0, sep);
    const channelId = rest.slice(sep + 1);
    return `teams-thread:${teamId}/${channelId}/${d.rootMessageId}`;
  }
  if (d.resourceCursorKey.startsWith('chat-')) {
    const chatId = d.resourceCursorKey.slice('chat-'.length);
    return `teams-thread:${chatId}/${d.rootMessageId}`;
  }
  return null;
}

/**
 * Soft-delete a batch of `source_artifacts` rows by their synthetic
 * `external_id`. Sets `deleted_at = now()` so HoloFs's
 * `WHERE deleted_at IS NULL` filter takes them out of retrieval
 * without losing the audit trail. The chunks themselves stay in the
 * `chunks` table until a separate purge job runs (today: never; the
 * next reindex of the same id replaces them).
 *
 * One UPDATE per batch — Drizzle's `inArray` with up to a few hundred
 * ids per sync run is fine; for unusually large deletion bursts the
 * caller can chunk in advance.
 */
async function softDeleteArtifacts(
  db: DB,
  organizationId: string,
  externalIds: string[],
): Promise<void> {
  if (externalIds.length === 0) return;
  await db
    .update(schema.sourceArtifacts)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.sourceArtifacts.organizationId, organizationId),
        inArray(schema.sourceArtifacts.externalId, externalIds),
      ),
    );
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
  externalIdForDeletion,
};
// Avoid unused-import warning for `ResourceCursor` (kept in scope for
// readers of this file's types).
void (null as unknown as ResourceCursor);
