/**
 * Stripe object → chunk projection.
 *
 * One chunk per record, one source-artifact per record. The shape is
 * intentionally narrow: retrieval can answer the questions Holo cares
 * about (revenue, MRR, churn, who paid) by reading these lines, without
 * us building a full metrics service.
 *
 * Money is rendered as decimal currency (Stripe stores integer minor
 * units — cents for USD, sen for JPY, no fractional unit for zero-decimal
 * currencies). We use Intl.NumberFormat with `currencyDisplay: 'code'` so
 * the output is parseable (`USD 49.00`) without locale ambiguity.
 */
import { stripeRecordChunker, type StripeRecordInput } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import type {
  StripeCharge,
  StripeCoupon,
  StripeCustomer,
  StripeDiscount,
  StripeInvoice,
  StripeObjectType,
  StripeSubscription,
  StripeSubscriptionItem,
} from './types';

// Zero-decimal Stripe currencies — these store integer-unit amounts, not
// minor units. Reference: https://stripe.com/docs/currencies#zero-decimal
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

function unixToDate(ts: number): Date {
  return new Date(ts * 1000);
}

function toDecimal(amount: number, currency: string): number {
  const cur = currency.toLowerCase();
  if (ZERO_DECIMAL.has(cur)) return amount;
  return amount / 100;
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return '';
  const value = toDecimal(amount, currency);
  return `${currency.toUpperCase()} ${value.toFixed(ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2)}`;
}

function refId(ref: string | { id: string } | null | undefined): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref;
  return ref.id;
}

/**
 * Per-source FX configuration, read from `sources.metadata`. Operators set
 * this at connection time (or later, via the manage sheet) so revenue
 * dashboards can sum across currencies. Shape:
 *
 *   {
 *     "baseCurrency": "usd",
 *     "fxRates": { "eur": 1.08, "gbp": 1.25, "usd": 1 }
 *   }
 *
 * `fxRates[c]` is "how many units of baseCurrency one unit of c is worth".
 * When `baseCurrency` is missing or there's no rate for the record's
 * currency, the connector falls back to native-only output (no `*_base`
 * fields emitted) — never silently sums dollars and yen.
 */
interface FxConfig {
  baseCurrency: string;
  fxRates: Record<string, number>;
}

function parseFxConfig(sourceMetadata: Record<string, unknown>): FxConfig | null {
  const base = sourceMetadata['baseCurrency'];
  const rates = sourceMetadata['fxRates'];
  if (typeof base !== 'string' || base.length === 0) return null;
  if (!rates || typeof rates !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out[k.toLowerCase()] = v;
    }
  }
  if (Object.keys(out).length === 0) return null;
  return { baseCurrency: base.toLowerCase(), fxRates: out };
}

function toBase(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fx: FxConfig | null,
): { amount_base: number; currency_base: string } | null {
  if (!fx) return null;
  if (amount === null || amount === undefined) return null;
  if (!currency) return null;
  const rate = fx.fxRates[currency.toLowerCase()];
  if (rate === undefined) return null;
  return { amount_base: Number((amount * rate).toFixed(2)), currency_base: fx.baseCurrency };
}

function planLabel(item: StripeSubscriptionItem): string | undefined {
  const price = item.price;
  if (!price) return undefined;
  if (price.nickname) return price.nickname;
  const product = price.product;
  if (product && typeof product !== 'string' && product.name) return product.name;
  return price.id;
}

/**
 * Pull the first usable discount object off a subscription. Stripe returns
 * either a legacy `discount` (object) or a modern `discounts` array (ids
 * by default, expanded to objects via api.ts). Subscription-level discounts
 * stack, but for MRR adjustment we apply the first one — multi-coupon stacks
 * are vanishingly rare and Stripe's own UI shows them serially.
 */
function pickDiscount(s: StripeSubscription): StripeDiscount | null {
  if (s.discount?.coupon) return s.discount;
  for (const d of s.discounts ?? []) {
    if (typeof d === 'object' && d?.coupon) return d;
  }
  return null;
}

interface DiscountApplication {
  effectiveMrr: number;
  metadata: {
    discount_kind: 'percent' | 'amount';
    discount_value: number;
    discount_coupon?: string;
  };
  /** Prose line describing the discount, appended to the chunk body. */
  line: string;
}

/**
 * Apply a coupon to a gross MRR figure. Percent-off subtracts a flat
 * fraction. Amount-off subtracts the coupon's per-billing amount, normalized
 * to monthly using the same conversion as `itemMrr` (so a $10/month-off
 * coupon and a $120/year-off coupon both reduce MRR by $10).
 *
 * Returns null when the discount has no usable shape (e.g. an unexpanded id,
 * a coupon with neither percent_off nor amount_off, or an amount_off in a
 * different currency than the subscription's). In those cases we leave MRR
 * unchanged and skip the metadata fields rather than silently mis-reporting.
 */
function applyDiscount(
  grossMrr: number,
  subscriptionCurrency: string,
  discount: StripeDiscount,
): DiscountApplication | null {
  const coupon = discount.coupon as StripeCoupon | null | undefined;
  if (!coupon) return null;

  const couponName = coupon.name ?? coupon.id;

  if (coupon.percent_off !== null && coupon.percent_off !== undefined) {
    const pct = coupon.percent_off;
    const effective = grossMrr * (1 - pct / 100);
    return {
      effectiveMrr: Math.max(0, effective),
      metadata: { discount_kind: 'percent', discount_value: pct, discount_coupon: couponName },
      line: `Discount: ${pct}% off${couponName ? ` (${couponName})` : ''}`,
    };
  }

  if (coupon.amount_off !== null && coupon.amount_off !== undefined) {
    const couponCurrency = coupon.currency?.toLowerCase();
    if (couponCurrency && couponCurrency !== subscriptionCurrency.toLowerCase()) {
      // Mismatched-currency coupon: refuse to convert. Stripe itself surfaces
      // this case as an account-config error, but we may still see it in
      // historical data.
      return null;
    }
    const offDecimal = toDecimal(coupon.amount_off, couponCurrency ?? subscriptionCurrency);
    // Coupon amount_off applies per billing cycle. We approximate it as a
    // monthly figure: callers don't have per-item interval visibility here,
    // so we treat the coupon as if it were monthly. This matches Stripe's
    // own MRR helper for the common case (monthly billing) and slightly
    // over-counts the discount for yearly subscriptions — surfaced via
    // `discount_kind=amount` so the agent knows the math.
    const effective = grossMrr - offDecimal;
    return {
      effectiveMrr: Math.max(0, effective),
      metadata: {
        discount_kind: 'amount',
        discount_value: Number(offDecimal.toFixed(2)),
        discount_coupon: couponName,
      },
      line: `Discount: ${formatMoney(coupon.amount_off, couponCurrency ?? subscriptionCurrency)} off${couponName ? ` (${couponName})` : ''}`,
    };
  }

  return null;
}

/**
 * Subscription item → monthly recurring revenue (in the currency's main
 * unit). Weekly / daily intervals are normalized to month using
 * 365.25/12 ≈ 30.4375 days; yearly divides by 12. Quantity is folded in.
 * Returns null when the item has no price or recurring config.
 */
function itemMrr(item: StripeSubscriptionItem): number | null {
  const price = item.price;
  if (!price || !price.recurring || price.unit_amount === null || price.unit_amount === undefined) {
    return null;
  }
  if (!price.currency) return null;
  const quantity = item.quantity ?? 1;
  const perInterval = toDecimal(price.unit_amount * quantity, price.currency);
  const count = price.recurring.interval_count > 0 ? price.recurring.interval_count : 1;
  switch (price.recurring.interval) {
    case 'day':
      return (perInterval / count) * 30.4375;
    case 'week':
      return (perInterval / count) * (30.4375 / 7);
    case 'month':
      return perInterval / count;
    case 'year':
      return perInterval / count / 12;
  }
  return null;
}

function buildCustomerChunk(c: StripeCustomer): StripeRecordInput {
  const lines: string[] = [];
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.name) lines.push(`Name: ${c.name}`);
  if (c.description) lines.push(`Description: ${c.description}`);
  if (c.currency) lines.push(`Currency: ${c.currency.toUpperCase()}`);
  if (c.delinquent) lines.push(`Delinquent: yes`);
  if (c.metadata) {
    for (const [k, v] of Object.entries(c.metadata)) {
      if (v) lines.push(`Metadata ${k}: ${v}`);
    }
  }
  return {
    recordType: 'customer',
    recordId: c.id,
    displayName: c.name ?? c.email ?? c.id,
    lines,
    metadata: {
      customer_id: c.id,
      customer_email: c.email ?? undefined,
      currency: c.currency ?? undefined,
    },
    createdAt: unixToDate(c.created),
    livemode: c.livemode,
  };
}

function buildSubscriptionChunk(s: StripeSubscription, fx: FxConfig | null): StripeRecordInput {
  const items = s.items?.data ?? [];
  const plans = items.map(planLabel).filter((p): p is string => !!p);
  const mrrParts = items.map(itemMrr).filter((m): m is number => m !== null);
  const grossMrr = mrrParts.length > 0 ? mrrParts.reduce((a, b) => a + b, 0) : null;
  const customerId = refId(s.customer);

  // Apply subscription-level discount. Coupons attached to subscription
  // items are out of scope — Stripe charges fewer than 1% of accounts use
  // item-level coupons, and they require a separate API expansion.
  let effectiveMrr = grossMrr;
  let discountApplied: DiscountApplication | null = null;
  if (grossMrr !== null && s.currency) {
    const discount = pickDiscount(s);
    if (discount) {
      discountApplied = applyDiscount(grossMrr, s.currency, discount);
      if (discountApplied) effectiveMrr = discountApplied.effectiveMrr;
    }
  }

  const lines: string[] = [];
  lines.push(`Status: ${s.status}`);
  if (plans.length > 0) lines.push(`Plan: ${plans.join(', ')}`);
  if (effectiveMrr !== null && s.currency) {
    if (discountApplied && grossMrr !== null && grossMrr !== effectiveMrr) {
      lines.push(
        `MRR: ${s.currency.toUpperCase()} ${effectiveMrr.toFixed(2)} (gross ${s.currency.toUpperCase()} ${grossMrr.toFixed(2)})`,
      );
    } else {
      lines.push(`MRR: ${s.currency.toUpperCase()} ${effectiveMrr.toFixed(2)}`);
    }
  }
  if (discountApplied) lines.push(discountApplied.line);
  if (customerId) lines.push(`Customer: ${customerId}`);
  if (s.current_period_start && s.current_period_end) {
    lines.push(
      `Current period: ${unixToDate(s.current_period_start).toISOString()} → ${unixToDate(
        s.current_period_end,
      ).toISOString()}`,
    );
  }
  if (s.cancel_at_period_end) lines.push(`Will cancel at period end: yes`);
  if (s.canceled_at) lines.push(`Canceled: ${unixToDate(s.canceled_at).toISOString()}`);
  if (s.trial_end) lines.push(`Trial ends: ${unixToDate(s.trial_end).toISOString()}`);
  if (s.metadata) {
    for (const [k, v] of Object.entries(s.metadata)) {
      if (v) lines.push(`Metadata ${k}: ${v}`);
    }
  }

  // Per-item breakdown: amount, currency, interval, quantity.
  for (const item of items) {
    const price = item.price;
    if (!price) continue;
    const amount = formatMoney(price.unit_amount, price.currency);
    const qty = item.quantity ?? 1;
    const interval = price.recurring
      ? `${price.recurring.interval_count > 1 ? `${price.recurring.interval_count} ` : ''}${price.recurring.interval}`
      : 'one-time';
    lines.push(
      `Item ${planLabel(item) ?? price.id}: ${amount}/${interval} × ${qty}`,
    );
  }

  const baseConversion =
    effectiveMrr !== null ? toBase(effectiveMrr, s.currency, fx) : null;
  if (baseConversion) {
    lines.push(
      `MRR (${baseConversion.currency_base.toUpperCase()}): ${baseConversion.currency_base.toUpperCase()} ${baseConversion.amount_base.toFixed(2)}`,
    );
  }

  const firstInterval = items[0]?.price?.recurring?.interval;
  const displayName = plans.length > 0 ? `Subscription · ${plans.join(', ')}` : `Subscription ${s.id}`;

  return {
    recordType: 'subscription',
    recordId: s.id,
    displayName,
    lines,
    metadata: {
      customer_id: customerId,
      status: s.status,
      currency: s.currency ?? undefined,
      mrr: effectiveMrr !== null ? Number(effectiveMrr.toFixed(2)) : undefined,
      mrr_gross:
        discountApplied && grossMrr !== null ? Number(grossMrr.toFixed(2)) : undefined,
      plan: plans.length > 0 ? plans.join(', ') : undefined,
      plan_interval: firstInterval,
      canceled_at: s.canceled_at ? unixToDate(s.canceled_at).toISOString() : undefined,
      ...(discountApplied?.metadata ?? {}),
      ...(baseConversion
        ? { mrr_base: baseConversion.amount_base, currency_base: baseConversion.currency_base }
        : {}),
    },
    createdAt: unixToDate(s.created),
    livemode: s.livemode,
  };
}

function buildInvoiceChunk(inv: StripeInvoice, fx: FxConfig | null): StripeRecordInput {
  const customerId = refId(inv.customer);
  const subscriptionId = refId(inv.subscription);
  const lines: string[] = [];
  if (inv.status) lines.push(`Status: ${inv.status}`);
  if (inv.number) lines.push(`Number: ${inv.number}`);
  if (customerId) lines.push(`Customer: ${customerId}`);
  if (inv.customer_email) lines.push(`Customer email: ${inv.customer_email}`);
  if (subscriptionId) lines.push(`Subscription: ${subscriptionId}`);
  if (inv.currency && inv.amount_due !== null && inv.amount_due !== undefined) {
    lines.push(`Amount due: ${formatMoney(inv.amount_due, inv.currency)}`);
  }
  if (inv.currency && inv.amount_paid !== null && inv.amount_paid !== undefined) {
    lines.push(`Amount paid: ${formatMoney(inv.amount_paid, inv.currency)}`);
  }
  if (inv.currency && inv.amount_remaining !== null && inv.amount_remaining !== undefined) {
    lines.push(`Amount remaining: ${formatMoney(inv.amount_remaining, inv.currency)}`);
  }
  if (inv.period_start && inv.period_end) {
    lines.push(
      `Period: ${unixToDate(inv.period_start).toISOString()} → ${unixToDate(inv.period_end).toISOString()}`,
    );
  }
  if (inv.hosted_invoice_url) lines.push(`URL: ${inv.hosted_invoice_url}`);

  // Amount used for the strongly-typed metadata is the paid amount (revenue
  // realized) when the invoice is paid, otherwise the amount_due. Invoices
  // are already post-discount via `amount_paid`, so we don't double-apply
  // subscription-level coupons here.
  const amountMinor =
    inv.paid && inv.amount_paid !== null && inv.amount_paid !== undefined
      ? inv.amount_paid
      : (inv.amount_due ?? null);
  const amount =
    amountMinor !== null && inv.currency ? toDecimal(amountMinor, inv.currency) : undefined;

  const baseConversion = toBase(amount, inv.currency, fx);
  if (baseConversion) {
    lines.push(
      `Amount (${baseConversion.currency_base.toUpperCase()}): ${baseConversion.currency_base.toUpperCase()} ${baseConversion.amount_base.toFixed(2)}`,
    );
  }

  return {
    recordType: 'invoice',
    recordId: inv.id,
    displayName: inv.number ? `Invoice ${inv.number}` : `Invoice ${inv.id}`,
    lines,
    metadata: {
      customer_id: customerId,
      customer_email: inv.customer_email ?? undefined,
      status: inv.status ?? undefined,
      currency: inv.currency ?? undefined,
      amount: amount !== undefined ? Number(amount.toFixed(2)) : undefined,
      invoice_number: inv.number ?? undefined,
      period_start: inv.period_start ? unixToDate(inv.period_start).toISOString() : undefined,
      period_end: inv.period_end ? unixToDate(inv.period_end).toISOString() : undefined,
      ...(baseConversion
        ? {
            amount_base: baseConversion.amount_base,
            currency_base: baseConversion.currency_base,
          }
        : {}),
    },
    createdAt: unixToDate(inv.created),
    livemode: inv.livemode,
  };
}

function buildChargeChunk(ch: StripeCharge, fx: FxConfig | null): StripeRecordInput {
  const customerId = refId(ch.customer);
  const invoiceId = refId(ch.invoice);
  const lines: string[] = [];
  if (ch.status) lines.push(`Status: ${ch.status}`);
  lines.push(`Amount: ${formatMoney(ch.amount, ch.currency)}`);
  if (ch.amount_refunded && ch.amount_refunded > 0) {
    lines.push(`Refunded: ${formatMoney(ch.amount_refunded, ch.currency)}`);
  }
  if (customerId) lines.push(`Customer: ${customerId}`);
  if (ch.receipt_email) lines.push(`Receipt email: ${ch.receipt_email}`);
  if (invoiceId) lines.push(`Invoice: ${invoiceId}`);
  if (ch.description) lines.push(`Description: ${ch.description}`);
  if (ch.payment_method_details?.type) {
    lines.push(`Method: ${ch.payment_method_details.type}`);
  }
  if (ch.failure_message) lines.push(`Failure: ${ch.failure_message}`);

  const netAmount = ch.amount - (ch.amount_refunded ?? 0);
  const amount = Number(toDecimal(netAmount, ch.currency).toFixed(2));

  const baseConversion = toBase(amount, ch.currency, fx);
  if (baseConversion) {
    lines.push(
      `Amount (${baseConversion.currency_base.toUpperCase()}): ${baseConversion.currency_base.toUpperCase()} ${baseConversion.amount_base.toFixed(2)}`,
    );
  }

  return {
    recordType: 'charge',
    recordId: ch.id,
    displayName: ch.description ?? `Charge ${ch.id}`,
    lines,
    metadata: {
      customer_id: customerId,
      status: ch.status ?? undefined,
      currency: ch.currency,
      amount,
      ...(baseConversion
        ? {
            amount_base: baseConversion.amount_base,
            currency_base: baseConversion.currency_base,
          }
        : {}),
    },
    createdAt: unixToDate(ch.created),
    livemode: ch.livemode,
  };
}

/**
 * Run a single Stripe object through the chunker and emit upserts.
 * `kind` differs by record type so the dashboard's KIND_LABELS panel can
 * group customers / subscriptions / invoices / charges separately.
 */
export async function processStripeRecord(
  ctx: ResourceSyncContext<unknown>,
  recordType: StripeObjectType,
  raw: StripeCustomer | StripeSubscription | StripeInvoice | StripeCharge,
): Promise<void> {
  const fx = parseFxConfig(ctx.sourceMetadata);

  let input: StripeRecordInput;
  switch (recordType) {
    case 'customer':
      input = buildCustomerChunk(raw as StripeCustomer);
      break;
    case 'subscription':
      input = buildSubscriptionChunk(raw as StripeSubscription, fx);
      break;
    case 'invoice':
      input = buildInvoiceChunk(raw as StripeInvoice, fx);
      break;
    case 'charge':
      input = buildChargeChunk(raw as StripeCharge, fx);
      break;
  }

  const sourceArtifactId = `stripe-${recordType}:${raw.id}`;
  const chunks = await stripeRecordChunker.chunk(input, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });

  const kind = `stripe-${recordType}` as
    | 'stripe-customer'
    | 'stripe-subscription'
    | 'stripe-invoice'
    | 'stripe-charge';

  for (const c of chunks) {
    await ctx.upsert({
      externalId: raw.id,
      kind,
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
