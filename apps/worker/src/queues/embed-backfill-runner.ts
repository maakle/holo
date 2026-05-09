import { holoError, ErrorCode } from '@holo/errors';
import type { EmbedderClient } from './embed-runner';
import type { EmbeddingModel } from './embed-insert';

/**
 * One backfill job re-embeds a batch of chunks under the operator's
 * currently-selected OpenAI tier (`OPENAI_EMBEDDING_MODEL`). The
 * scanner picks rows whose `embedding_model` doesn't match the target
 * — typically that's `openai-3-large` chunks left over from before
 * PR #128 flipped the default to `-small`, but the same machinery
 * also handles a future swap (e.g. operator switches to `-large` and
 * needs to migrate `-small` chunks back).
 *
 * Idempotency: the store filter is `embedding_model = $sourceModel`,
 * so a chunk that's already on the target (concurrent run, duplicate
 * enqueue, re-deploy) is silently skipped.
 */
export interface BackfillJobPayload {
  chunkIds: string[];
  /** Tag rows must currently match to be rewritten. */
  sourceModel: EmbeddingModel;
  /** Tag to write after re-embedding. */
  targetModel: EmbeddingModel;
}

export interface ChunkToBackfill {
  id: string;
  content: string;
}

export interface BackfillStore {
  /** Returns rows matching `id IN (ids)` AND `embedding_model = sourceModel`. */
  selectChunksMatchingModel(
    ids: string[],
    sourceModel: EmbeddingModel,
  ): Promise<ChunkToBackfill[]>;
  /**
   * Sets `embedding`, `embedding_model = targetModel` on each row,
   * conditional on `embedding_model = sourceModel` so a concurrent
   * writer can't be clobbered. `updated_at` is intentionally NOT
   * bumped — this is a re-encoding, not a content change, and
   * bumping it would corrupt "last activity" surfaces in the
   * dashboard.
   */
  updateEmbeddings(args: {
    rows: Array<{ id: string; embedding: number[] }>;
    sourceModel: EmbeddingModel;
    targetModel: EmbeddingModel;
  }): Promise<void>;
}

export interface BackfillResult {
  /** Total ids in the payload — what the scanner asked us to consider. */
  scanned: number;
  /** Chunks actually re-embedded and written. */
  rewritten: number;
  /** Ids skipped because they were already migrated (or no longer exist). */
  skipped: number;
}

export async function runEmbedBackfillJob(args: {
  payload: BackfillJobPayload;
  embedder: EmbedderClient;
  store: BackfillStore;
}): Promise<BackfillResult> {
  const { chunkIds, sourceModel, targetModel } = args.payload;
  const scanned = chunkIds.length;
  if (scanned === 0) return { scanned: 0, rewritten: 0, skipped: 0 };

  if (sourceModel === targetModel) {
    // No-op job — nothing to migrate. Reaching this path means the
    // scanner enqueued spuriously; we return cleanly so retries don't
    // pile up.
    return { scanned, rewritten: 0, skipped: scanned };
  }

  const chunks = await args.store.selectChunksMatchingModel(chunkIds, sourceModel);
  const skipped = scanned - chunks.length;
  if (chunks.length === 0) return { scanned, rewritten: 0, skipped };

  // Backfill targets are always OpenAI tags (Voyage code chunks aren't
  // touched by this job — they keep their original tag). Routing the
  // whole batch through `targetModel` is what gives us a single
  // upstream call per job.
  const vectors = await args.embedder.embedBatch(
    targetModel,
    chunks.map((c) => c.content),
  );
  if (vectors.length !== chunks.length) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
      fix: 'Embedder-side bug — inspect the OpenAI adapter for partial responses.',
    });
  }

  await args.store.updateEmbeddings({
    rows: chunks.map((c, i) => ({ id: c.id, embedding: vectors[i]! })),
    sourceModel,
    targetModel,
  });

  return { scanned, rewritten: chunks.length, skipped };
}
