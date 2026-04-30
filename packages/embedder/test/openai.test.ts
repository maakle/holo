import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createOpenAiEmbedder } from '../src/openai';

const API_BASE = 'https://api.openai.com';
const EMBED_PATH = '/v1/embeddings';

/** No-op sleep so retry tests run instantly. */
const noSleep = (): Promise<void> => Promise.resolve();

/** Build a fake embedding response for `count` vectors of `dim` dimensions. */
function fakeEmbedResponse(count: number, dim = 1024) {
  return {
    object: 'list',
    data: Array.from({ length: count }, (_, i) => ({
      object: 'embedding',
      index: i,
      embedding: Array.from({ length: dim }, () => Math.random()),
    })),
    model: 'text-embedding-3-large',
    usage: { prompt_tokens: count * 5, total_tokens: count * 5 },
  };
}

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
  // Ensure no pending mocks remain (optional guard).
  nock.restore();
  nock.activate();
});

describe('createOpenAiEmbedder', () => {
  it('exposes model: openai-3-large and dimensions: 1024', () => {
    const embedder = createOpenAiEmbedder({ apiKey: 'test-key' });
    expect(embedder.model).toBe('openai-3-large');
    expect(embedder.dimensions).toBe(1024);
  });

  it('embeds a small batch in one call (2 inputs → 2 vectors of length 1024)', async () => {
    nock(API_BASE)
      .post(EMBED_PATH)
      .reply(200, fakeEmbedResponse(2));

    const embedder = createOpenAiEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const result = await embedder.embed(['hello', 'world']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1024);
    expect(result[1]).toHaveLength(1024);
  });

  it('splits >100 inputs into multiple calls (250 inputs → 3 calls: 100+100+50)', async () => {
    // 250 inputs → chunks of 100, 100, 50 → 3 separate API calls
    nock(API_BASE).post(EMBED_PATH).reply(200, fakeEmbedResponse(100));
    nock(API_BASE).post(EMBED_PATH).reply(200, fakeEmbedResponse(100));
    nock(API_BASE).post(EMBED_PATH).reply(200, fakeEmbedResponse(50));

    const inputs = Array.from({ length: 250 }, (_, i) => `text-${i}`);
    const embedder = createOpenAiEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const result = await embedder.embed(inputs);

    expect(result).toHaveLength(250);
    // Verify all 3 nock mocks were consumed
    expect(nock.isDone()).toBe(true);
  });

  it('retries on 429 with backoff then succeeds (1 fail, 1 success → 1 vector)', async () => {
    nock(API_BASE)
      .post(EMBED_PATH)
      .reply(429, { error: { message: 'rate limited', type: 'requests', code: 'rate_limit_exceeded' } });
    nock(API_BASE)
      .post(EMBED_PATH)
      .reply(200, fakeEmbedResponse(1));

    const embedder = createOpenAiEmbedder({ apiKey: 'test-key', sleep: noSleep });
    const result = await embedder.embed(['hello']);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1024);
    expect(nock.isDone()).toBe(true);
  });

  it('throws HOLO_INGESTION_RATE_LIMITED after retries exhausted (5 consecutive 429s)', async () => {
    // withBackoff default maxAttempts=5 → 5 total attempts → 5 mocks
    for (let i = 0; i < 5; i++) {
      nock(API_BASE)
        .post(EMBED_PATH)
        .reply(429, { error: { message: 'rate limited', type: 'requests', code: 'rate_limit_exceeded' } });
    }

    const embedder = createOpenAiEmbedder({ apiKey: 'test-key', sleep: noSleep });

    await expect(embedder.embed(['hello'])).rejects.toMatchObject({
      code: 'HOLO_INGESTION_RATE_LIMITED',
    });

    // Verify all 5 mocks were consumed
    expect(nock.isDone()).toBe(true);
  });
});
