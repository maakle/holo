import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computeLlmCreditsForUsage, computeSyncCreditsForRun } from '../src/pricing';

/**
 * Stub DB whose drizzle-shaped chain ultimately resolves to a price row.
 *
 * For LLM math the helpers call `resolveCreditsPerUnit` four times in parallel
 * (input, output, cache_read, cache_create). We mock the chain to return
 * `rates` in the order they're consumed by the helper — `computeLlmCreditsForUsage`
 * fires them in `Promise.all([input, output, cache_read, cache_create])`.
 *
 * For sync math only one `resolveCreditsPerUnit` call fires per assertion.
 *
 * We do NOT try to introspect the drizzle SQL — that's brittle. The unit
 * under test is the math, not the SQL.
 */
function stubDbWithRates(rates: number[]) {
  let i = 0;
  const limit = vi.fn(async () => {
    const rate = rates[i++];
    return rate !== undefined ? [{ rate: rate.toString() }] : [];
  });
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as Parameters<typeof computeLlmCreditsForUsage>[0]['db'];
}

describe('computeLlmCreditsForUsage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('multiplies token buckets by per-1K rates and sums', async () => {
    // Order: input, output, cache_read, cache_create
    const db = stubDbWithRates([400, 1950, 40, 500]);

    const result = await computeLlmCreditsForUsage({
      db,
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 2000,
        outputTokens: 1000,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 0,
      },
    });

    // 2000 * 400 / 1000 = 800
    // 1000 * 1950 / 1000 = 1950
    // 5000 * 40 / 1000 = 200
    // 0 * 500 / 1000 = 0
    expect(result.breakdown.llm_input_tokens).toBe(800);
    expect(result.breakdown.llm_output_tokens).toBe(1950);
    expect(result.breakdown.cache_read_tokens).toBe(200);
    expect(result.breakdown.cache_create_tokens).toBe(0);
    expect(result.total).toBe(2950);
  });

  it('returns 0 when no usage data is supplied', async () => {
    const db = stubDbWithRates([400, 1950, 40, 500]);
    const result = await computeLlmCreditsForUsage({
      db,
      model: 'whatever',
      usage: {},
    });
    expect(result.total).toBe(0);
  });

  it('ceils per-bucket so a 1-token call costs ≥ 1 credit', async () => {
    const db = stubDbWithRates([400, 1950, 40, 500]);
    const result = await computeLlmCreditsForUsage({
      db,
      model: 'claude-sonnet-4-6',
      usage: { inputTokens: 1, outputTokens: 0 },
    });
    expect(result.breakdown.llm_input_tokens).toBe(1);
    expect(result.breakdown.llm_output_tokens).toBe(0);
  });
});

describe('computeSyncCreditsForRun', () => {
  it('multiplies artifact count by per-provider rate', async () => {
    const db = stubDbWithRates([5]);
    const credits = await computeSyncCreditsForRun({
      db,
      provider: 'github',
      artifactCount: 47,
    });
    expect(credits).toBe(235);
  });

  it('returns 0 for empty syncs', async () => {
    const db = stubDbWithRates([5]);
    expect(
      await computeSyncCreditsForRun({ db, provider: 'github', artifactCount: 0 }),
    ).toBe(0);
  });
});
