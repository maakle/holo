import { describe, it, expect } from 'vitest';
import {
  runEmbedBackfillJob,
  type BackfillStore,
  type ChunkToBackfill,
} from '../src/queues/embed-backfill-runner';
import type { EmbedderClient } from '../src/queues/embed-runner';
import type { EmbeddingModel } from '../src/queues/embed-insert';

const SOURCE: EmbeddingModel = 'openai-3-large';
const TARGET: EmbeddingModel = 'openai-3-small';

function fakeEmbedder(): EmbedderClient & { calls: Array<{ model: string; n: number }> } {
  const calls: Array<{ model: string; n: number }> = [];
  return {
    calls,
    async embedBatch(model: EmbeddingModel, texts: string[]): Promise<number[][]> {
      calls.push({ model, n: texts.length });
      return texts.map(() => Array.from({ length: 1024 }, () => 0.1));
    },
  };
}

function fakeStore(seedChunks: ChunkToBackfill[]) {
  const updates: Array<{ id: string; embedding: number[]; targetModel: EmbeddingModel }> = [];
  // Track which ids still carry the SOURCE tag. Once update flips them
  // to TARGET, they no longer match `selectChunksMatchingModel(ids,
  // SOURCE)` — mirroring the production filter.
  const stillSource = new Set(seedChunks.map((c) => c.id));
  const store: BackfillStore = {
    async selectChunksMatchingModel(ids, sourceModel) {
      if (sourceModel !== SOURCE) return [];
      return seedChunks.filter((c) => ids.includes(c.id) && stillSource.has(c.id));
    },
    async updateEmbeddings({ rows, sourceModel, targetModel }) {
      expect(sourceModel).toBe(SOURCE);
      for (const r of rows) {
        if (!stillSource.has(r.id)) continue;
        updates.push({ ...r, targetModel });
        stillSource.delete(r.id);
      }
    },
  };
  return { store, updates };
}

describe('runEmbedBackfillJob', () => {
  it('rewrites every chunk in the batch from source to target', async () => {
    const chunks: ChunkToBackfill[] = [
      { id: 'a', content: 'alpha' },
      { id: 'b', content: 'bravo' },
      { id: 'c', content: 'charlie' },
    ];
    const embedder = fakeEmbedder();
    const { store, updates } = fakeStore(chunks);

    const result = await runEmbedBackfillJob({
      payload: { chunkIds: ['a', 'b', 'c'], sourceModel: SOURCE, targetModel: TARGET },
      embedder,
      store,
    });

    expect(result).toEqual({ scanned: 3, rewritten: 3, skipped: 0 });
    expect(embedder.calls).toEqual([{ model: TARGET, n: 3 }]);
    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b', 'c']);
    expect(updates.every((u) => u.targetModel === TARGET)).toBe(true);
  });

  it('skips ids that no longer match the source tag', async () => {
    // Only `a` is still on SOURCE; `b` and `c` were migrated by a prior run.
    const chunks: ChunkToBackfill[] = [{ id: 'a', content: 'alpha' }];
    const embedder = fakeEmbedder();
    const { store, updates } = fakeStore(chunks);

    const result = await runEmbedBackfillJob({
      payload: { chunkIds: ['a', 'b', 'c'], sourceModel: SOURCE, targetModel: TARGET },
      embedder,
      store,
    });

    expect(result).toEqual({ scanned: 3, rewritten: 1, skipped: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('a');
  });

  it('no-ops cleanly on an empty payload', async () => {
    const embedder = fakeEmbedder();
    const { store } = fakeStore([]);
    const result = await runEmbedBackfillJob({
      payload: { chunkIds: [], sourceModel: SOURCE, targetModel: TARGET },
      embedder,
      store,
    });
    expect(result).toEqual({ scanned: 0, rewritten: 0, skipped: 0 });
    expect(embedder.calls).toEqual([]);
  });

  it('no-ops when source and target are the same', async () => {
    // Operator reverted the env mid-flight; the scanner shouldn't have
    // enqueued anything but if it did, the job exits cleanly without
    // calling the embedder.
    const chunks: ChunkToBackfill[] = [{ id: 'a', content: 'alpha' }];
    const embedder = fakeEmbedder();
    const { store, updates } = fakeStore(chunks);
    const result = await runEmbedBackfillJob({
      payload: { chunkIds: ['a'], sourceModel: TARGET, targetModel: TARGET },
      embedder,
      store,
    });
    expect(result).toEqual({ scanned: 1, rewritten: 0, skipped: 1 });
    expect(embedder.calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('throws when the embedder returns the wrong number of vectors', async () => {
    const chunks: ChunkToBackfill[] = [
      { id: 'a', content: 'alpha' },
      { id: 'b', content: 'bravo' },
    ];
    const { store } = fakeStore(chunks);
    const brokenEmbedder: EmbedderClient = {
      async embedBatch(): Promise<number[][]> {
        return [Array.from({ length: 1024 }, () => 0)]; // 1 vector for 2 chunks
      },
    };
    await expect(
      runEmbedBackfillJob({
        payload: { chunkIds: ['a', 'b'], sourceModel: SOURCE, targetModel: TARGET },
        embedder: brokenEmbedder,
        store,
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });

  it('idempotent: re-running the same payload after a successful run rewrites nothing', async () => {
    const chunks: ChunkToBackfill[] = [{ id: 'a', content: 'alpha' }];
    const embedder = fakeEmbedder();
    const { store } = fakeStore(chunks);

    const first = await runEmbedBackfillJob({
      payload: { chunkIds: ['a'], sourceModel: SOURCE, targetModel: TARGET },
      embedder,
      store,
    });
    const second = await runEmbedBackfillJob({
      payload: { chunkIds: ['a'], sourceModel: SOURCE, targetModel: TARGET },
      embedder,
      store,
    });

    expect(first.rewritten).toBe(1);
    expect(second).toEqual({ scanned: 1, rewritten: 0, skipped: 1 });
    // Embedder only called for the first run.
    expect(embedder.calls).toEqual([{ model: TARGET, n: 1 }]);
  });

  it('handles a future swap target (e.g. operator goes -small → -large)', async () => {
    // Same machinery should drive the reverse migration once an
    // operator picks `-large` as their tier.
    const chunks: ChunkToBackfill[] = [{ id: 'a', content: 'alpha' }];
    const embedder = fakeEmbedder();
    const customStore: BackfillStore = {
      async selectChunksMatchingModel(ids, sourceModel) {
        expect(sourceModel).toBe('openai-3-small');
        return chunks.filter((c) => ids.includes(c.id));
      },
      async updateEmbeddings({ targetModel }) {
        expect(targetModel).toBe('openai-3-large');
      },
    };

    const result = await runEmbedBackfillJob({
      payload: {
        chunkIds: ['a'],
        sourceModel: 'openai-3-small',
        targetModel: 'openai-3-large',
      },
      embedder,
      store: customStore,
    });

    expect(result.rewritten).toBe(1);
    expect(embedder.calls).toEqual([{ model: 'openai-3-large', n: 1 }]);
  });
});
