import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  bigint,
  integer,
  boolean,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization } from './auth';

/**
 * Catalogue of selectable plans. Static-ish: rows are seeded by migration and
 * only edited by hand for now. `stripe_price_id` is filled in PR 2 when the
 * paid plans get wired to Stripe; PR 1 leaves it null.
 *
 * `features` JSONB shape:
 *   { maxConnectors: number | null,           // null = unlimited
 *     syncIntervalTier: 'standard' | 'priority',
 *     sampleDataIncluded: boolean }
 *
 * Star Wars sample data is exempt from `maxConnectors` because the sample
 * isn't a `connector_credentials` row — it lives in `sources` with
 * `metadata.sample = true`. The free tier therefore gets the sample + one
 * real connector slot.
 */
export const billingPlans = pgTable('billing_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  monthlyCredits: bigint('monthly_credits', { mode: 'number' }).notNull(),
  monthlyPriceCents: integer('monthly_price_cents').notNull(),
  stripePriceId: text('stripe_price_id'),
  features: jsonb('features').$type<{
    maxConnectors: number | null;
    syncIntervalTier?: 'standard' | 'priority';
    sampleDataIncluded?: boolean;
  }>().notNull().default({ maxConnectors: null }),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per organisation. Cache of Stripe state; in PR 1 every org is on
 * `free` and `stripe_customer_id` / `stripe_subscription_id` are null.
 *
 * `current_period_*` drives the monthly grant cron — when `now() >=
 * current_period_end`, the cron advances the period and writes a `grant`
 * row into `credit_ledger`. The grant cron is replaced by Stripe's
 * `invoice.payment_succeeded` webhook in PR 2.
 *
 * `status` mirrors Stripe's subscription statuses plus `unbilled` (the PR 1
 * state for orgs that haven't been wired to a Stripe customer yet).
 */
export const organizationSubscriptions = pgTable('organization_subscriptions', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => billingPlans.id),
  status: text('status', {
    enum: ['active', 'trialing', 'past_due', 'canceled', 'unbilled'],
  })
    .notNull()
    .default('unbilled'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Externalised price book. Most recent row (per (kind, selector)) wins; null
 * `effective_to` means the row is current. SQL UPDATE to retire a price
 * (set `effective_to = now()`), INSERT a new row with `effective_from = now()`
 * to introduce a replacement. Founder tunes prices here without redeploy.
 *
 * `kind` is the unit of metering:
 *   - 'llm_input_tokens' | 'llm_output_tokens'
 *   - 'cache_read_tokens' | 'cache_create_tokens'
 *   - 'sync_artifact'
 *
 * `selector` is what the unit applies to:
 *   - for llm_* / cache_*: the model id (e.g. 'claude-sonnet-4-6')
 *   - for sync_artifact: the provider id (e.g. 'github', 'stripe')
 *   - '*' is the default fallback when no specific selector matches.
 *
 * `credits_per_unit` for token kinds is **per 1K tokens**, for sync_artifact
 * is **per artifact**. See `packages/billing/src/pricing.ts` for the math.
 */
export const creditPrices = pgTable(
  'credit_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    selector: text('selector').notNull(),
    creditsPerUnit: numeric('credits_per_unit', { precision: 20, scale: 8 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindSelectorFromIdx: index('credit_prices_kind_selector_from_idx').on(
      t.kind,
      t.selector,
      t.effectiveFrom.desc(),
    ),
  }),
);

/**
 * Append-only credit ledger. Balance is a fold: `SELECT SUM(credits) FROM
 * credit_ledger WHERE organization_id = $1`. Never UPDATE or DELETE rows —
 * refunds + corrections are compensating entries.
 *
 * `credits` is signed: positive for grants/topups/refunds-to-customer, negative
 * for debits/expiries. Sum across all rows = current balance.
 *
 * `idempotency_key` is the replay-safety contract: each writer derives a
 * deterministic key from the source event (e.g. uuidv5 of `sync_run:<id>`).
 * A second insert with the same key is a no-op via `ON CONFLICT DO NOTHING`,
 * so retries from BullMQ / agent re-runs never double-debit. The same UUID
 * doubles as the `identifier` parameter on Stripe Meter Events in PR 2.
 *
 * `reference_kind` + `reference_id` link back to the originating row when
 * one exists (an `mcp_invocations` row, a `sync_runs` row, a Stripe invoice).
 * `manual` refunds use `reference_kind='manual'` and a free-form id.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['grant', 'debit', 'refund', 'expiry', 'topup', 'adjustment'],
    }).notNull(),
    credits: bigint('credits', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    referenceKind: text('reference_kind'),
    referenceId: text('reference_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('credit_ledger_org_created_idx').on(
      t.organizationId,
      t.createdAt.desc(),
    ),
    orgKindCreatedIdx: index('credit_ledger_org_kind_created_idx').on(
      t.organizationId,
      t.kind,
      t.createdAt.desc(),
    ),
    orgReasonCreatedIdx: index('credit_ledger_org_reason_created_idx').on(
      t.organizationId,
      t.reason,
      t.createdAt.desc(),
    ),
  }),
);

/**
 * Idempotency log for Stripe webhook deliveries. Stripe guarantees at-least-once
 * delivery; we de-dupe by event id (Stripe's `evt_*` identifier is the unique
 * key here). Receiver: insert with ON CONFLICT DO NOTHING — if a row already
 * exists for the id, skip processing entirely.
 *
 * `payload` is the raw event JSON so we can re-process or debug without a
 * round-trip to Stripe. Keep it; the table is small (one row per inbound
 * event) and the audit value outweighs the storage cost.
 */
export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    /** Stripe's `evt_*` event id; we use it as the PK. */
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
  },
  (t) => ({
    typeReceivedIdx: index('stripe_webhook_events_type_received_idx').on(t.type, t.receivedAt.desc()),
  }),
);
