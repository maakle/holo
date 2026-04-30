import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVoyageEmbedder } from '../src/voyage';

// Mock the voyageai module — must be at top level (vitest hoists vi.mock).
// We test OUR code (chunking, backoff, error mapping); SDK HTTP is upstream's concern.
const mockEmbed = vi.fn();
vi.mock('voyageai', () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: mockEmbed,
  })),
  // backoff.ts checks: err instanceof VoyageAIError && err.statusCode === 429
  VoyageAIError: class VoyageAIError extends Error {
    statusCode?: number;
    constructor(opts: { message: string; statusCode?: number }) {
      super(opts.message);
      this.name = 'VoyageAIError';
      this.statusCode = opts.statusCode;
    }
  },
}));

/** No-op sleep so retry tests run instantly. */
const noSleep = (): Promise<void> => Promise.resolve();

/** Build a deterministic embedding vector seeded by `seed`. */
const vec = (seed: number): number[] =>
  Array.from({ length: 1024 }, (_, i) => (seed + i) % 11);

describe('createVoyageEmbedder', () => {
  beforeEach(() => {
    mockEmbed.mockReset();
  });

  it('exposes model: voyage-code-3 and dimensions: 1024', () => {
    const embedder = createVoyageEmbedder({ apiKey: 'test-key' });
    expect(embedder.model).toBe('voyage-code-3');
    expect(embedder.dimensions).toBe(1024);
  });

  it('embeds a small batch in one call (2 inputs → 2 vectors of length 1024)', async () => {
    mockEmbed.mockResolvedValueOnce({
      data: [
        { embedding: vec(1), index: 0 },
        { embedding: vec(2), index: 1 },
      ],
    });

    const embedder = createVoyageEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const out = await embedder.embed(['fn foo() {}', 'class Bar {}']);

    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1024);
    expect(out[1]).toHaveLength(1024);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it('splits >128 inputs into multiple calls (300 inputs → 3 calls: 128+128+44)', async () => {
    const inputs = Array.from({ length: 300 }, (_, i) => `code-${i}`);

    mockEmbed
      .mockResolvedValueOnce({
        data: Array.from({ length: 128 }, (_, i) => ({ embedding: vec(i), index: i })),
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 128 }, (_, i) => ({ embedding: vec(i + 128), index: i })),
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 44 }, (_, i) => ({ embedding: vec(i + 256), index: i })),
      });

    const embedder = createVoyageEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const out = await embedder.embed(inputs);

    expect(out).toHaveLength(300);
    expect(mockEmbed).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 with backoff then succeeds (1 fail, 1 success → 1 vector)', async () => {
    const { VoyageAIError } = await import('voyageai');
    mockEmbed
      .mockRejectedValueOnce(new VoyageAIError({ message: 'rate limit', statusCode: 429 }))
      .mockResolvedValueOnce({ data: [{ embedding: vec(1), index: 0 }] });

    const embedder = createVoyageEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const out = await embedder.embed(['x']);

    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1024);
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it('throws HOLO_INGESTION_RATE_LIMITED after retries exhausted (5 consecutive 429s)', async () => {
    const { VoyageAIError } = await import('voyageai');
    for (let i = 0; i < 5; i++) {
      mockEmbed.mockRejectedValueOnce(
        new VoyageAIError({ message: 'rate limit', statusCode: 429 }),
      );
    }

    const embedder = createVoyageEmbedder({ apiKey: 'test-key', sleep: noSleep });
    await expect(embedder.embed(['x'])).rejects.toMatchObject({
      code: 'HOLO_INGESTION_RATE_LIMITED',
    });
    expect(mockEmbed).toHaveBeenCalledTimes(5);
  });
});
