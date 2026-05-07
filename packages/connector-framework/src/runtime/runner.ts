import { createHash } from 'node:crypto';
import { ErrorCode, holoError } from '@holo/errors';
import { createHttpClient } from '../http/client';
import { buildPaginator } from '../pagination/paginate';
import type {
  ChunkUpsert,
  ConnectorSpec,
  ReportProgressFn,
  ResourceSpec,
  ResourceSyncContext,
} from '../types';
import type {
  ChunkRecord,
  RuntimeStores,
  SyncJobInput,
  SyncJobResult,
} from './stores';

const DEFAULT_BATCH_SIZE = 50;

export interface RunConnectorSyncInput extends SyncJobInput {
  spec: ConnectorSpec;
  stores: RuntimeStores;
  reportProgress?: ReportProgressFn;
  signal?: AbortSignal;
  /** Override flush batch size (tests). Defaults to 50. */
  batchSize?: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

function chunkHash(kind: string, content: string): string {
  return createHash('sha256').update(`${kind}:${content}`).digest('hex');
}

function deriveSourceArtifactId(provider: string, kind: string, externalId: string): string {
  return `${provider}-${kind}:${externalId}`;
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

  const tokens = await stores.loadTokens({ organizationId, providerId: spec.id });
  const api = createHttpClient({
    config: spec.http,
    auth: spec.auth,
    tokens,
    fetchImpl: input.fetchImpl,
  });
  const paginate = buildPaginator({ client: api });
  const existingHashes = await stores.loadExistingHashes({ organizationId });

  let artifactCount = 0;
  const cursorPatch: Record<string, unknown> = {};
  const emptyResources: string[] = [];

  for (const resource of spec.resources) {
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
      reportProgress: input.reportProgress,
      signal: input.signal,
      async upsert(chunk: ChunkUpsert): Promise<void> {
        const hash = chunkHash(chunk.kind, chunk.content);
        if (existingHashes.has(hash)) return;
        existingHashes.add(hash);
        pending.push({
          externalId: chunk.externalId,
          kind: chunk.kind,
          content: chunk.content,
          contentHash: hash,
          metadata: chunk.metadata,
          aclSubjects: chunk.aclSubjects,
          sourceArtifactId: deriveSourceArtifactId(spec.id, chunk.kind, chunk.externalId),
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
