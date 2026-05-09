import { describe, it, expect } from 'vitest';
import {
  runEmbedBackfillJob,
  type BackfillStore,
  type ChunkToBackfill,
} from '../src/queues/embed-backfill-runner';
import type { EmbedderClient } from '../src/queues/embed-runner';
import type { EmbeddingModel } from '../src/queues/embed-insert';

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

function fakeStore(legacyChunks: ChunkToBackfill[]) {
  const updates: Array<{ id: string; embedding: number[] }> = [];
  // Track which ids the store still considers `-large`. Once update is
  // called, those rows flip to `-small` and won't reappear in
  // `selectLegacyChunks` — mirroring the production `embedding_model =
  // 'openai-3-large'` filter.
  const stillLegacy = new Set(legacyChunks.map((c) => c.id));
  const store: BackfillStore = {
    async selectLegacyChunks(ids: string[]) {
      return legacyChunks.filter((c) => ids.includes(c.id) && stillLegacy.has(c.id));
    },
    async updateEmbeddings(rows) {
      for (const r of rows) {
        updates.push(r);
        stillLegacy.delete(r.id);
      }
    },
  };
  return { store, updates };
}

describe('runEmbedBackfillJob', () => {
  it('rewrites every legacy chunk in the batch', async () => {
    const chunks: ChunkToBackfill[] = [
      { id: 'a', content: 'alpha' },
      { id: 'b', content: 'bravo' },
      { id: 'c', content: 'charlie' },
    ];
    const embedder = fakeEmbedder();
    const { store, updates } = fakeStore(chunks);

    const result = await runEmbedBackfillJob({
      payload: { chunkIds: ['a', 'b', 'c'] },
      embedder,
      store,
    });

    expect(result).toEqual({ scanned: 3, rewritten: 3, skipped: 0 });
    expect(embedder.calls).toEqual([{ model: 'openai-3-small', n: 3 }]);
    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips ids that are already migrated (filtered out by the store)', async () => {
    // Only `a` is still tagged legacy in the DB; `b` and `c` were already
    // rewritten by a prior run.
    const chunks: ChunkToBackfill[] = [{ id: 'a', content: 'alpha' }];
    const embedder = fakeEmbedder();
    const { store, updates } = fakeStore(chunks);

    const result = await runEmbedBackfillJob({
      payload: { chunkIds: ['a', 'b', 'c'] },
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
      payload: { chunkIds: [] },
      embedder,
      store,
    });
    expect(result).toEqual({ scanned: 0, rewritten: 0, skipped: 0 });
    expect(embedder.calls).toEqual([]);
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
        payload: { chunkIds: ['a', 'b'] },
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
      payload: { chunkIds: ['a'] },
      embedder,
      store,
    });
    const second = await runEmbedBackfillJob({
      payload: { chunkIds: ['a'] },
      embedder,
      store,
    });

    expect(first.rewritten).toBe(1);
    expect(second).toEqual({ scanned: 1, rewritten: 0, skipped: 1 });
    // Embedder only called for the first run.
    expect(embedder.calls).toEqual([{ model: 'openai-3-small', n: 1 }]);
  });
});
