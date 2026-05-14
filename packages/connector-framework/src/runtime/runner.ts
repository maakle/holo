import { createHash } from 'node:crypto';
import { ErrorCode, holoError } from '@holo/errors';
import { createHttpClient } from '../http/client';
import { buildPaginator } from '../pagination/paginate';
import type {
  ChunkUpsert,
  ConnectorSpec,
  ConnectorTokens,
  ReportProgressFn,
  ResourceSpec,
  ResourceSyncContext,
} from '../types';
import type {
  ChunkRecord,
  RuntimeStores,
  SyncBreakdown,
  SyncJobInput,
  SyncJobResult,
} from './stores';

const DEFAULT_BATCH_SIZE = 50;
/**
 * Refresh threshold: if a token expires within this many ms, refresh it
 * before kicking off the sync. Sized to cover the longest expected sync
 * (~15 min for big GitHub orgs) plus a comfortable safety margin so a
 * resource that runs late doesn't fire a stale token at the provider.
 */
const REFRESH_SKEW_MS = 20 * 60_000;

function shouldRefresh(expiresAt: Date | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
}

/**
 * Load tokens and, when the spec uses a refreshable strategy and the
 * access token is near expiry, refresh-and-persist before the resources
 * run. The refresh is serialized via `stores.withAuthLock` so that
 * concurrent jobs sharing `(organizationId, providerId)` — GitLab's prose
 * and code queues both wake at the 6h mark — don't double-refresh and
 * race over the rotated refresh token.
 */
async function loadValidTokens(args: {
  spec: ConnectorSpec;
  stores: RuntimeStores;
  organizationId: string;
}): Promise<ConnectorTokens> {
  const { spec, stores, organizationId } = args;
  const tokens = await stores.loadTokens({ organizationId, providerId: spec.id });

  if (
    !spec.auth.refreshable ||
    !tokens.refreshToken ||
    !shouldRefresh(tokens.expiresAt)
  ) {
    return tokens;
  }

  const refreshOnce = async (): Promise<ConnectorTokens> => {
    // Re-read inside the critical section. If another worker beat us to
    // the lock and already refreshed, the row now holds a fresh access
    // token (and a rotated refresh token); calling auth.refresh() again
    // would consume the old refresh token and fail.
    const fresh = await stores.loadTokens({ organizationId, providerId: spec.id });
    if (!fresh.refreshToken || !shouldRefresh(fresh.expiresAt)) return fresh;
    const refreshed = await spec.auth.refresh({ refreshToken: fresh.refreshToken });
    await stores.saveTokens?.({ organizationId, providerId: spec.id, tokens: refreshed });
    return refreshed;
  };

  return stores.withAuthLock
    ? stores.withAuthLock({ organizationId, providerId: spec.id }, refreshOnce)
    : refreshOnce();
}

export interface RunConnectorSyncInput extends SyncJobInput {
  spec: ConnectorSpec;
  stores: RuntimeStores;
  reportProgress?: ReportProgressFn;
  signal?: AbortSignal;
  /** Override flush batch size (tests). Defaults to 50. */
  batchSize?: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /**
   * Run only these resource ids (in spec declaration order). When omitted
   * every resource on the spec runs. Used by hosts that map one spec across
   * multiple queues (e.g. GitHub: prose-queue runs `prose`, code-queue runs
   * `code`).
   */
  resources?: ReadonlyArray<string>;
}

function chunkHash(kind: string, content: string): string {
  return createHash('sha256').update(`${kind}:${content}`).digest('hex');
}

/**
 * Synthetic source-artifact id. Connector kinds are already provider-prefixed
 * by convention (e.g. 'slack-thread', 'notion-page', 'pylon-ticket'), so we
 * use `${kind}:${externalId}` verbatim — this matches the legacy connectors'
 * format and keeps existing `source_artifacts` rows valid across migrations.
 */
function deriveSourceArtifactId(_provider: string, kind: string, externalId: string): string {
  return `${kind}:${externalId}`;
}

/**
 * Run every resource on the spec in declaration order. Each resource gets
 * its own cursor row. The runtime owns the API client lifecycle, dedupe
 * tracking, and chunk batching — the spec author only writes the per-page
 * iteration logic.
 */
export async function runConnectorSync(input: RunConnectorSyncInput): Promise<SyncJobResult> {
  const { spec, stores, organizationId, sourceId } = input;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!spec.http) {
    throw holoError({
      code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
      problem: `Spec ${spec.id} declares no http config; runtime cannot build an API client`,
      fix: 'Add an `http: { baseUrl, ... }` block to the spec.',
    });
  }

  const tokens = await loadValidTokens({ spec, stores, organizationId });
  const api = createHttpClient({
    config: spec.http,
    auth: spec.auth,
    tokens,
    fetchImpl: input.fetchImpl,
  });
  const paginate = buildPaginator({ client: api });
  const existingHashes = await stores.loadExistingHashes({ organizationId });
  const allowlist = stores.loadAllowlist
    ? await stores.loadAllowlist({ organizationId, providerId: spec.id })
    : [];
  const sourceMetadata = stores.loadSourceMetadata
    ? await stores.loadSourceMetadata({ sourceId })
    : {};

  let artifactCount = 0;
  const cursorPatch: Record<string, unknown> = {};
  const emptyResources: string[] = [];
  // Per-kind breakdown of what the upsert path did this run. Keyed by chunk
  // kind (e.g. 'github-pr', 'linear-issue'). Mutated in the closure below;
  // returned on the SyncJobResult so the worker can persist it on sync_runs.
  const breakdown: SyncBreakdown = {};
  // Per-(provider, kind) "no URL emitted" warning dedup. The agent surface
  // needs `metadata.url` (or `metadata.permalink`) on every chunk to render
  // citations as clickable deep links — without it, the model can cite the
  // chunk but the user sees no destination. We warn once per kind per sync
  // so existing gaps surface in operator logs without spamming.
  const warnedKinds = new Set<string>();
  const hasUrl = (metadata: Record<string, unknown>): boolean => {
    const url = metadata['url'];
    if (typeof url === 'string' && url.length > 0) return true;
    const permalink = metadata['permalink'];
    return typeof permalink === 'string' && permalink.length > 0;
  };
  const tallyNew = (kind: string): void => {
    const slot = breakdown[kind] ?? { new: 0, deduped: 0 };
    slot.new += 1;
    breakdown[kind] = slot;
  };
  const tallyDeduped = (kind: string): void => {
    const slot = breakdown[kind] ?? { new: 0, deduped: 0 };
    slot.deduped += 1;
    breakdown[kind] = slot;
  };

  const resourceFilter = input.resources ? new Set(input.resources) : null;

  for (const resource of spec.resources) {
    if (resourceFilter && !resourceFilter.has(resource.id)) continue;
    input.signal?.throwIfAborted();
    const before = artifactCount;

    const rawCursor = await stores.loadCursor({ sourceId, resourceId: resource.id });
    const cursor = parseCursor(resource, rawCursor);

    let pending: ChunkRecord[] = [];

    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      await stores.enqueueChunks({ organizationId, sourceId, chunks: batch });
    };

    const ctx: ResourceSyncContext<unknown> = {
      organizationId,
      sourceId,
      tokens,
      api,
      paginate,
      cursor,
      allowlist,
      sourceMetadata,
      reportProgress: input.reportProgress,
      signal: input.signal,
      async upsert(chunk: ChunkUpsert): Promise<void> {
        if (!hasUrl(chunk.metadata) && !warnedKinds.has(chunk.kind)) {
          warnedKinds.add(chunk.kind);
          console.warn(
            `[connector-framework] ${spec.id}: chunks of kind '${chunk.kind}' are being upserted without metadata.url or metadata.permalink. Citations to this content cannot deep-link from the Slack/Web answer surface. See packages/connectors/README.md "URL invariant".`,
          );
        }
        const hash = chunkHash(chunk.kind, chunk.content);
        if (existingHashes.has(hash)) {
          tallyDeduped(chunk.kind);
          return;
        }
        existingHashes.add(hash);
        tallyNew(chunk.kind);
        pending.push({
          externalId: chunk.externalId,
          kind: chunk.kind,
          content: chunk.content,
          contentHash: hash,
          metadata: chunk.metadata,
          aclSubjects: chunk.aclSubjects,
          sourceArtifactId:
            chunk.sourceArtifactId ??
            deriveSourceArtifactId(spec.id, chunk.kind, chunk.externalId),
          provider: spec.id,
          organizationId,
          sourceId,
        });
        artifactCount += 1;
        if (pending.length >= batchSize) await flush();
      },
      async flushCursor(next: unknown): Promise<void> {
        // Best-effort partial cursor flush; matches Slack's per-channel
        // checkpointing so a mid-sync crash resumes mid-resource.
        await stores.saveCursor({
          organizationId,
          sourceId,
          resourceId: resource.id,
          cursor: next,
        });
      },
    };

    let newCursor: unknown;
    try {
      newCursor = await resource.sync(ctx);
    } finally {
      // Always flush whatever we accumulated, even on error — work already
      // done shouldn't be discarded just because the next page failed.
      await flush();
    }

    // Persist the resource's cursor at the end. flushCursor() above may have
    // written interim values; the final write supersedes them.
    await stores.saveCursor({
      organizationId,
      sourceId,
      resourceId: resource.id,
      cursor: newCursor,
    });
    cursorPatch[resource.id] = newCursor;

    if (artifactCount === before) emptyResources.push(resource.id);
  }

  return {
    artifactCount,
    cursorPatch,
    emptyResources: emptyResources.length > 0 ? emptyResources : undefined,
    breakdown,
  };
}

function parseCursor(resource: ResourceSpec<unknown>, raw: unknown): unknown {
  // Schema's `.default()` covers the `undefined` case (first run).
  const result = resource.cursorSchema.safeParse(raw);
  if (result.success) return result.data;
  throw holoError({
    code: ErrorCode.HOLO_INTERNAL,
    problem: `Cursor for resource '${resource.id}' failed schema validation`,
    cause: JSON.stringify(result.error.issues),
    fix: 'A previous version persisted an incompatible cursor. Reset the resource cursor row.',
  });
}
