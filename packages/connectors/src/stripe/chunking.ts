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
  StripeCustomer,
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

function planLabel(item: StripeSubscriptionItem): string | undefined {
  const price = item.price;
  if (!price) return undefined;
  if (price.nickname) return price.nickname;
  const product = price.product;
  if (product && typeof product !== 'string' && product.name) return product.name;
  return price.id;
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

function buildSubscriptionChunk(s: StripeSubscription): StripeRecordInput {
  const items = s.items?.data ?? [];
  const plans = items.map(planLabel).filter((p): p is string => !!p);
  const mrrParts = items.map(itemMrr).filter((m): m is number => m !== null);
  const mrr = mrrParts.length > 0 ? mrrParts.reduce((a, b) => a + b, 0) : null;
  const customerId = refId(s.customer);

  const lines: string[] = [];
  lines.push(`Status: ${s.status}`);
  if (plans.length > 0) lines.push(`Plan: ${plans.join(', ')}`);
  if (mrr !== null && s.currency) {
    lines.push(`MRR: ${s.currency.toUpperCase()} ${mrr.toFixed(2)}`);
  }
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
      mrr: mrr !== null ? Number(mrr.toFixed(2)) : undefined,
      plan: plans.length > 0 ? plans.join(', ') : undefined,
      plan_interval: firstInterval,
      canceled_at: s.canceled_at ? unixToDate(s.canceled_at).toISOString() : undefined,
    },
    createdAt: unixToDate(s.created),
    livemode: s.livemode,
  };
}

function buildInvoiceChunk(inv: StripeInvoice): StripeRecordInput {
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
  // realized) when the invoice is paid, otherwise the amount_due.
  const amountMinor =
    inv.paid && inv.amount_paid !== null && inv.amount_paid !== undefined
      ? inv.amount_paid
      : (inv.amount_due ?? null);
  const amount =
    amountMinor !== null && inv.currency ? toDecimal(amountMinor, inv.currency) : undefined;

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
    },
    createdAt: unixToDate(inv.created),
    livemode: inv.livemode,
  };
}

function buildChargeChunk(ch: StripeCharge): StripeRecordInput {
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
  return {
    recordType: 'charge',
    recordId: ch.id,
    displayName: ch.description ?? `Charge ${ch.id}`,
    lines,
    metadata: {
      customer_id: customerId,
      status: ch.status ?? undefined,
      currency: ch.currency,
      amount: Number(toDecimal(netAmount, ch.currency).toFixed(2)),
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
  let input: StripeRecordInput;
  switch (recordType) {
    case 'customer':
      input = buildCustomerChunk(raw as StripeCustomer);
      break;
    case 'subscription':
      input = buildSubscriptionChunk(raw as StripeSubscription);
      break;
    case 'invoice':
      input = buildInvoiceChunk(raw as StripeInvoice);
      break;
    case 'charge':
      input = buildChargeChunk(raw as StripeCharge);
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
