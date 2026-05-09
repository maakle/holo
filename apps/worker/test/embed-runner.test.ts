import { describe, it, expect, vi } from 'vitest';
import {
  runEmbedJob,
  modelForChunkKind,
  type EmbedderClient,
} from '../src/queues/embed-runner';
import type {
  ChunkInsertPayload,
  EmbedJobPayload,
  EmbeddedChunkRow,
} from '../src/queues/embed-insert';

function makeChunk(i: number, kind: string): ChunkInsertPayload {
  return {
    kind,
    content: `chunk content ${kind} ${i}`,
    metadata: { idx: i },
    aclSubjects: ['org:org-1'],
    organizationId: 'org-1',
    sourceId: 'src-1',
    sourceArtifactId: `art-${i}`,
    provider: 'github',
    contentHash: `hash-${kind}-${i}`,
  };
}

// In-memory replacement for insertEmbeddedChunks. Honors the
// `INSERT ... ON CONFLICT (organization_id, content_hash) DO NOTHING` semantic.
function makeFakeInsert() {
  const seen = new Set<string>();
  const inserted: EmbeddedChunkRow[] = [];
  return {
    inserted,
    insertChunks: async (rows: EmbeddedChunkRow[]): Promise<number> => {
      let n = 0;
      for (const r of rows) {
        const key = `${r.chunk.organizationId}::${r.chunk.contentHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        inserted.push(r);
        n += 1;
      }
      return n;
    },
  };
}

describe('modelForChunkKind', () => {
  it('routes github-code → voyage-code-3, others → openai-3-small', () => {
    expect(modelForChunkKind('github-code')).toBe('voyage-code-3');
    expect(modelForChunkKind('github-prose')).toBe('openai-3-small');
    expect(modelForChunkKind('slack')).toBe('openai-3-small');
    expect(modelForChunkKind('notion')).toBe('openai-3-small');
  });
});

describe('runEmbedJob', () => {
  it('groups by model, dispatches one batch per model, and inserts all rows', async () => {
    const proseChunks = Array.from({ length: 50 }, (_, i) => makeChunk(i, 'github-prose'));
    const codeChunks = Array.from({ length: 25 }, (_, i) => makeChunk(i + 100, 'github-code'));
    const payload: EmbedJobPayload = {
      chunks: [...proseChunks, ...codeChunks],
      organizationId: 'org-1',
      sourceArtifactId: 'art-mixed',
    };

    const embedder: EmbedderClient = {
      embedBatch: vi.fn(async (_model, texts) =>
        texts.map((_t, i) => Array.from({ length: 1024 }, () => i / 1024)),
      ),
    };

    const fake = makeFakeInsert();
    const result = await runEmbedJob({
      payload,
      embedder,
      insertChunks: fake.insertChunks,
    });

    expect(embedder.embedBatch).toHaveBeenCalledTimes(2);
    const calls = (embedder.embedBatch as ReturnType<typeof vi.fn>).mock.calls;
    const models = calls.map((c) => c[0]).sort();
    expect(models).toEqual(['openai-3-small', 'voyage-code-3']);
    expect(result.inserted).toBe(75);
    expect(result.perModel).toEqual({
      'openai-3-small': 50,
      'openai-3-large': 0,
      'voyage-code-3': 25,
    });
    expect(fake.inserted.length).toBe(75);
    // Verify model is recorded correctly per row
    const codeInserted = fake.inserted.filter((r) => r.chunk.kind === 'github-code');
    const proseInserted = fake.inserted.filter((r) => r.chunk.kind === 'github-prose');
    expect(codeInserted.every((r) => r.embeddingModel === 'voyage-code-3')).toBe(true);
    expect(proseInserted.every((r) => r.embeddingModel === 'openai-3-small')).toBe(true);
  });

  it('re-running the same payload inserts 0 additional rows (ON CONFLICT DO NOTHING)', async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => makeChunk(i, 'github-prose'));
    const payload: EmbedJobPayload = {
      chunks,
      organizationId: 'org-1',
      sourceArtifactId: 'art-dup',
    };
    const embedder: EmbedderClient = {
      embedBatch: vi.fn(async (_m, texts) => texts.map(() => new Array(1024).fill(0))),
    };
    const fake = makeFakeInsert();

    const first = await runEmbedJob({ payload, embedder, insertChunks: fake.insertChunks });
    const second = await runEmbedJob({ payload, embedder, insertChunks: fake.insertChunks });

    expect(first.inserted).toBe(10);
    expect(second.inserted).toBe(0); // duplicates suppressed
    expect(fake.inserted.length).toBe(10);
  });

  it('skips embedder dispatch entirely for empty groups', async () => {
    const onlyProse = Array.from({ length: 5 }, (_, i) => makeChunk(i, 'github-prose'));
    const payload: EmbedJobPayload = {
      chunks: onlyProse,
      organizationId: 'org-1',
      sourceArtifactId: 'art-prose-only',
    };
    const embedder: EmbedderClient = {
      embedBatch: vi.fn(async (_m, texts) => texts.map(() => new Array(1024).fill(0))),
    };
    const fake = makeFakeInsert();
    const result = await runEmbedJob({ payload, embedder, insertChunks: fake.insertChunks });

    expect(embedder.embedBatch).toHaveBeenCalledTimes(1); // openai only
    expect(result.perModel).toEqual({
      'openai-3-small': 5,
      'openai-3-large': 0,
      'voyage-code-3': 0,
    });
  });

  it('throws on embedder vector/chunk count mismatch', async () => {
    const chunks = Array.from({ length: 3 }, (_, i) => makeChunk(i, 'github-prose'));
    const payload: EmbedJobPayload = {
      chunks,
      organizationId: 'org-1',
      sourceArtifactId: 'art-mismatch',
    };
    const embedder: EmbedderClient = {
      embedBatch: vi.fn(async () => [new Array(1024).fill(0), new Array(1024).fill(0)]),
    };
    const fake = makeFakeInsert();
    await expect(
      runEmbedJob({ payload, embedder, insertChunks: fake.insertChunks }),
    ).rejects.toThrow(/embedder returned 2 vectors for 3 chunks/);
  });

  it('throws if neither sql nor insertChunks is provided', async () => {
    const payload: EmbedJobPayload = {
      chunks: [makeChunk(0, 'github-prose')],
      organizationId: 'org-1',
      sourceArtifactId: 'art',
    };
    const embedder: EmbedderClient = {
      embedBatch: vi.fn(async (_m, texts) => texts.map(() => new Array(1024).fill(0))),
    };
    await expect(runEmbedJob({ payload, embedder })).rejects.toThrow(
      /runEmbedJob requires either sql or insertChunks/,
    );
  });
});
