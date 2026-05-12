import type { Chunker, Chunk, ChunkContext } from './contract';

/**
 * Stripe-record chunker. Each Stripe object becomes one chunk so retrieval
 * can answer growth- and revenue-shaped questions ("MRR by plan", "who
 * paid last week", "which customers churned in May") without baking a
 * dedicated metrics service: the content lines are explicit enough that
 * an LLM can aggregate over chunks the search returns. Money is rendered
 * as decimal currency (Stripe stores integer minor units) so the model
 * doesn't need to know the cents-vs-yen rule per currency.
 */

export type StripeRecordType = 'customer' | 'subscription' | 'invoice' | 'charge';

export interface StripeRecordInput {
  recordType: StripeRecordType;
  recordId: string;
  /** Human-friendly label (customer name/email, subscription summary, invoice number, …). */
  displayName: string;
  /** Already-formatted "key: value" lines the chunker should append after the header. */
  lines: ReadonlyArray<string>;
  /**
   * Strongly-typed metadata fields used for filtered retrieval ("invoices
   * in May", "subscriptions on the Pro plan", "charges over $10k"). The
   * chunker drops keys whose value is `undefined`.
   */
  metadata: StripeRecordMetadata;
  createdAt: Date;
  /** Stripe's `livemode` flag, surfaced so dashboards can filter test data. */
  livemode: boolean;
}

export interface StripeRecordMetadata {
  customer_id?: string;
  customer_email?: string;
  status?: string;
  currency?: string;
  /** Total monetary amount in the record's currency, as decimal units (e.g. 49.00). */
  amount?: number;
  /**
   * For subscriptions: normalized monthly recurring revenue in the record's
   * currency, **after** any subscription-level discount has been applied.
   * Pair with `mrr_gross` to see how much the discount removed.
   */
  mrr?: number;
  /** Gross MRR before discounts. Only emitted when a discount is present. */
  mrr_gross?: number;
  plan_interval?: 'day' | 'week' | 'month' | 'year';
  /** Comma-joined plan/product nicknames for subscriptions. */
  plan?: string;
  /** 'percent' when coupon.percent_off is set, 'amount' for coupon.amount_off. */
  discount_kind?: 'percent' | 'amount';
  /** Percent (0-100) or decimal-currency amount, depending on `discount_kind`. */
  discount_value?: number;
  /** Coupon id / name surfaced for retrieval ("which subs have COMMIT2026 applied"). */
  discount_coupon?: string;
  /** ISO 4217 base currency (lowercase) when FX normalization is configured. */
  currency_base?: string;
  /** `amount` converted into `currency_base` using the source's FX table. */
  amount_base?: number;
  /** Subscription MRR converted into `currency_base`. */
  mrr_base?: number;
  invoice_number?: string;
  period_start?: string;
  period_end?: string;
  /** Subscription cancel timestamp (ISO) when status is canceled. */
  canceled_at?: string;
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * Emits one chunk per Stripe object. All chunks share the same
 * `parentExternalId` (`stripe-<type>:<id>`) so retrieval can group a record
 * with later updates. `chunk_role` is set to `record` for parity with the
 * HubSpot chunker — the dashboard's KIND_LABELS panel reads it.
 */
export const stripeRecordChunker: Chunker<StripeRecordInput> = {
  kind: 'stripe-record',
  embeddingModel: 'openai-3-small',

  async chunk(input: StripeRecordInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `stripe-${input.recordType}:${input.recordId}`;
    const aclSubjects = [`org:${ctx.organizationId}`];

    const metadata: Record<string, unknown> = {
      chunk_role: 'record',
      record_type: input.recordType,
      record_id: input.recordId,
      display_name: input.displayName,
      created_at: input.createdAt.toISOString(),
      livemode: input.livemode,
    };
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v === undefined) continue;
      metadata[k] = v;
    }

    const header = [
      `# ${input.displayName}`,
      '',
      `Type: stripe-${input.recordType}`,
      `Created: ${formatDate(input.createdAt)}`,
    ];
    if (!input.livemode) header.push('Mode: test');

    const body = input.lines.filter((l) => l.trim().length > 0);
    const content = [...header, ...(body.length > 0 ? ['', ...body] : [])]
      .join('\n')
      .trimEnd();

    return [
      {
        content,
        parentExternalId,
        metadata,
        aclSubjects,
      },
    ];
  },
};
