import { and, eq, isNull, or, sql, desc } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { LLMUsage } from '@holo/llm';

const { creditPrices } = schema;

export type PriceKind =
  | 'llm_input_tokens'
  | 'llm_output_tokens'
  | 'cache_read_tokens'
  | 'cache_create_tokens'
  | 'sync_artifact';

/**
 * Resolve a credit-per-unit rate from the price book. Most recent row
 * (effective_from desc, effective_to null) for the matching (kind, selector)
 * wins; falls back to selector='*' when no exact match exists.
 *
 * Returns 0 when nothing matches — billing then treats the event as
 * unpriced (no debit). That's a safer default than guessing a price.
 */
export async function resolveCreditsPerUnit(
  db: DB,
  kind: PriceKind,
  selector: string,
): Promise<number> {
  // Try the specific selector first.
  const exact = await db
    .select({ rate: creditPrices.creditsPerUnit })
    .from(creditPrices)
    .where(
      and(
        eq(creditPrices.kind, kind),
        eq(creditPrices.selector, selector),
        or(isNull(creditPrices.effectiveTo), sql`${creditPrices.effectiveTo} > now()`),
        sql`${creditPrices.effectiveFrom} <= now()`,
      ),
    )
    .orderBy(desc(creditPrices.effectiveFrom))
    .limit(1);
  if (exact.length > 0) return Number(exact[0]!.rate);

  if (selector !== '*') {
    return resolveCreditsPerUnit(db, kind, '*');
  }
  return 0;
}

/**
 * Convert a `LLMUsage` payload + model id into a total credit debit.
 * Token-count fields are per-1000 priced (see migration 0059 seeds); we
 * `ceil` per bucket so a 1-token call still costs at least 1 unit of rate.
 */
export async function computeLlmCreditsForUsage(args: {
  db: DB;
  model: string;
  usage: LLMUsage;
}): Promise<{ total: number; breakdown: Record<PriceKind, number> }> {
  const { db, model, usage } = args;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheCreate = usage.cacheCreationInputTokens ?? 0;

  const [inputRate, outputRate, cacheReadRate, cacheCreateRate] = await Promise.all([
    resolveCreditsPerUnit(db, 'llm_input_tokens', model),
    resolveCreditsPerUnit(db, 'llm_output_tokens', model),
    resolveCreditsPerUnit(db, 'cache_read_tokens', model),
    resolveCreditsPerUnit(db, 'cache_create_tokens', model),
  ]);

  const buckets: Record<PriceKind, number> = {
    llm_input_tokens: Math.ceil((inputTokens * inputRate) / 1000),
    llm_output_tokens: Math.ceil((outputTokens * outputRate) / 1000),
    cache_read_tokens: Math.ceil((cacheRead * cacheReadRate) / 1000),
    cache_create_tokens: Math.ceil((cacheCreate * cacheCreateRate) / 1000),
    sync_artifact: 0,
  };
  const total =
    buckets.llm_input_tokens +
    buckets.llm_output_tokens +
    buckets.cache_read_tokens +
    buckets.cache_create_tokens;
  return { total, breakdown: buckets };
}

/**
 * Convert a finished sync_runs row into a credit debit. `artifactCount` is
 * the total chunks newly inserted (the `new` column of the per-kind
 * breakdown). Dedup'd chunks are free — the org already paid for them on
 * the original sync.
 */
export async function computeSyncCreditsForRun(args: {
  db: DB;
  provider: string;
  artifactCount: number;
}): Promise<number> {
  const rate = await resolveCreditsPerUnit(args.db, 'sync_artifact', args.provider);
  return Math.ceil(args.artifactCount * rate);
}
