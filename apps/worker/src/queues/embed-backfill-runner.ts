import { holoError, ErrorCode } from '@holo/errors';
import type { EmbedderClient } from './embed-runner';

/**
 * One backfill job rewrites a batch of chunks from the legacy
 * `openai-3-large` embeddings to the new `openai-3-small` embeddings (same
 * 1024 dimensionality, ~6.5× cheaper). The boot scanner enqueues batches;
 * this runner processes one batch.
 *
 * Idempotency: the runner re-checks `embedding_model = 'openai-3-large'`
 * inside the DB read, so a chunk that was already migrated (e.g. by a
 * concurrent run, or a duplicate enqueue from a re-deploy) is silently
 * skipped. Safe to enqueue the same chunk id twice.
 */
export interface BackfillJobPayload {
  chunkIds: string[];
}

export interface ChunkToBackfill {
  id: string;
  content: string;
}

export interface BackfillStore {
  /** Returns rows matching `id IN (...)` AND `embedding_model = 'openai-3-large'`. */
  selectLegacyChunks(ids: string[]): Promise<ChunkToBackfill[]>;
  /**
   * Updates `embedding`, `embedding_model = 'openai-3-small'` for each
   * chunk. Caller decides batching/transactional semantics.
   * `updated_at` is intentionally NOT bumped: this is a re-encoding, not
   * a content change, and bumping it would corrupt "last activity"
   * surfaces in the dashboard.
   */
  updateEmbeddings(
    rows: Array<{ id: string; embedding: number[] }>,
  ): Promise<void>;
}

export interface BackfillResult {
  /** Total ids in the payload — what the scanner asked us to consider. */
  scanned: number;
  /** Chunks actually re-embedded and written. */
  rewritten: number;
  /** Ids skipped because they were already migrated (or no longer exist). */
  skipped: number;
}

const BACKFILL_MODEL = 'openai-3-small' as const;

export async function runEmbedBackfillJob(args: {
  payload: BackfillJobPayload;
  embedder: EmbedderClient;
  store: BackfillStore;
}): Promise<BackfillResult> {
  const { chunkIds } = args.payload;
  const scanned = chunkIds.length;
  if (scanned === 0) return { scanned: 0, rewritten: 0, skipped: 0 };

  const chunks = await args.store.selectLegacyChunks(chunkIds);
  const skipped = scanned - chunks.length;
  if (chunks.length === 0) return { scanned, rewritten: 0, skipped };

  // Every legacy chunk we're rewriting is prose: code chunks were already
  // tagged `voyage-code-3`, so they don't appear in this scan. Route the
  // whole batch through the OpenAI embedder.
  const vectors = await args.embedder.embedBatch(
    BACKFILL_MODEL,
    chunks.map((c) => c.content),
  );
  if (vectors.length !== chunks.length) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
      fix: 'Embedder-side bug — inspect the OpenAI adapter for partial responses.',
    });
  }

  await args.store.updateEmbeddings(
    chunks.map((c, i) => ({ id: c.id, embedding: vectors[i]! })),
  );

  return { scanned, rewritten: chunks.length, skipped };
}
