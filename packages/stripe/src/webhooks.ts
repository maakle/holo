import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { writeLedgerEntry } from '@holo/billing';
import { holoError, ErrorCode } from '@holo/errors';
import { getStripeClient } from './client';
import { readStripeEnv } from './env';

const { billingPlans, organizationSubscriptions, stripeWebhookEvents } = schema;

/**
 * Verify the raw payload + Stripe signature header and return the parsed
 * event. Throws if the signature is invalid — callers should treat that as
 * a 400 (Stripe stops retrying after 4xx so we don't end up in a hot loop
 * for malformed requests).
 *
 * `rawBody` MUST be the unmodified request bytes; the web app's webhook
 * route reads `await req.text()` before any JSON parsing.
 */
export function verifyStripeSignature(args: {
  rawBody: string;
  signature: string;
}): Stripe.Event {
  const stripe = getStripeClient();
  const { webhookSecret } = readStripeEnv();
  try {
    return stripe.webhooks.constructEvent(args.rawBody, args.signature, webhookSecret);
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Stripe webhook signature verification failed: ${(err as Error).message}`,
      fix: 'Confirm STRIPE_WEBHOOK_SECRET matches the endpoint signing secret in the Stripe dashboard.',
    });
  }
}

/**
 * Idempotent webhook dispatch. Records the event in `stripe_webhook_events`
 * (PK = Stripe event id) — second deliveries are no-ops via ON CONFLICT.
 * Then routes by `event.type` to the appropriate handler.
 *
 * Stripe guarantees at-least-once delivery and retries failed deliveries
 * with backoff. Every state-changing action this function takes (ledger
 * writes, subscription updates) is itself idempotent so multiple deliveries
 * converge to the same end state.
 */
export async function handleStripeEvent(db: DB, event: Stripe.Event): Promise<void> {
  // 1. Record + dedupe.
  const insert = await db
    .insert(stripeWebhookEvents)
    .values({
      id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.id })
    .returning({ id: stripeWebhookEvents.id });
  if (insert.length === 0) return; // Duplicate delivery.

  // 2. Dispatch.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(db, event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionChanged(db, event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await onInvoicePaid(db, event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await onInvoiceFailed(db, event.data.object as Stripe.Invoice);
        break;
      default:
        // Ignore everything else; Stripe sends many event types we don't care about.
        break;
    }
    await db
      .update(stripeWebhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(stripeWebhookEvents.id, event.id));
  } catch (err) {
    // Record the failure so we can replay later; let the error propagate so
    // Stripe retries the delivery.
    await db
      .update(stripeWebhookEvents)
      .set({ processingError: (err as Error).message.slice(0, 1000) })
      .where(eq(stripeWebhookEvents.id, event.id));
    throw err;
  }
}

// ---- Individual handlers --------------------------------------------------

/**
 * First charge cleared. Stripe has already created the Subscription on its
 * side; we update our cache, swap the plan, and issue the first monthly
 * grant. The subsequent `customer.subscription.created` (or `.updated`)
 * event will also fire — handlers below are idempotent so the convergence
 * is fine.
 */
async function onCheckoutCompleted(
  db: DB,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const organizationId =
    (session.metadata?.organization_id as string | undefined) ??
    (session.subscription
      ? (await readSubscriptionMetadata(session.subscription)).organizationId
      : null);
  if (!organizationId) return;
  if (!session.subscription) return;

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

  // Fetch the canonical subscription state from Stripe so our cache mirrors
  // the source of truth, not a partial Checkout payload.
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  await applySubscriptionState(db, organizationId, subscription);
}

async function onSubscriptionChanged(
  db: DB,
  subscription: Stripe.Subscription,
): Promise<void> {
  const organizationId = (subscription.metadata?.organization_id as string | undefined) ?? null;
  if (!organizationId) return;
  await applySubscriptionState(db, organizationId, subscription);
}

async function onSubscriptionDeleted(
  db: DB,
  subscription: Stripe.Subscription,
): Promise<void> {
  const organizationId = (subscription.metadata?.organization_id as string | undefined) ?? null;
  if (!organizationId) return;

  // Drop back to the free tier. Period start/end stays as-is — the next
  // free-tier grant cron tick will roll it forward.
  const free = await db
    .select()
    .from(billingPlans)
    .where(eq(billingPlans.slug, 'free'))
    .limit(1);
  if (free.length === 0) return;
  await db
    .update(organizationSubscriptions)
    .set({
      planId: free[0]!.id,
      status: 'canceled',
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.organizationId, organizationId));
}

/**
 * Each invoice payment is a period renewal — write a `monthly_grant` ledger
 * row. This is the production replacement for the worker `billing-grants`
 * cron from PR 1; the cron stays as a backstop for free-tier orgs (which
 * have no Stripe subscription).
 *
 * Idempotency key shape mirrors PR 1: `grant:<org_id>:<period_start_iso>`.
 */
async function onInvoicePaid(db: DB, invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  const organizationId = (subscription.metadata?.organization_id as string | undefined) ?? null;
  if (!organizationId) return;

  await applySubscriptionState(db, organizationId, subscription);
}

async function onInvoiceFailed(db: DB, invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  const organizationId = (subscription.metadata?.organization_id as string | undefined) ?? null;
  if (!organizationId) return;

  await db
    .update(organizationSubscriptions)
    .set({ status: 'past_due', updatedAt: new Date() })
    .where(eq(organizationSubscriptions.organizationId, organizationId));
}

/**
 * In API version basil (2025-08-27), `Invoice.subscription` moved off the
 * root and onto `invoice.parent.subscription_details.subscription`. Wrap the
 * lookup here so handlers stay readable.
 */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

// ---- Helpers --------------------------------------------------------------

/**
 * Sync a Stripe `Subscription` into our cache + issue any grant the new
 * period implies. Single source of truth for "Stripe state landed; reflect
 * it here." Called from every handler that learns the subscription has
 * moved.
 */
async function applySubscriptionState(
  db: DB,
  organizationId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const planSlug = subscription.metadata?.plan_slug as string | undefined;
  if (!planSlug) return;

  const planRows = await db
    .select()
    .from(billingPlans)
    .where(eq(billingPlans.slug, planSlug))
    .limit(1);
  const plan = planRows[0];
  if (!plan) return;

  // In API version basil, current_period_* moved off the Subscription root
  // and onto each SubscriptionItem. We bill a single item per subscription
  // (one plan, one price), so item 0 carries the canonical period.
  const item = subscription.items.data[0];
  if (!item) return;
  const periodStart = stripeTimestampToDate(item.current_period_start);
  const periodEnd = stripeTimestampToDate(item.current_period_end);
  const status = mapStripeStatus(subscription.status);

  await db
    .update(organizationSubscriptions)
    .set({
      planId: plan.id,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      stripeSubscriptionId: subscription.id,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.organizationId, organizationId));

  // Issue the period's grant. The idempotency key includes the period start
  // so each billing cycle gets exactly one grant even if multiple webhooks
  // converge (e.g. `subscription.updated` + `invoice.payment_succeeded`).
  if (
    Number(plan.monthlyCredits) > 0 &&
    (status === 'active' || status === 'trialing')
  ) {
    await writeLedgerEntry(db, {
      organizationId,
      kind: 'grant',
      credits: Number(plan.monthlyCredits),
      reason: 'monthly_grant',
      referenceKind: 'stripe_invoice',
      referenceId: subscription.id,
      idempotencyKey: `grant:${organizationId}:${periodStart.toISOString()}`,
      metadata: {
        plan_slug: plan.slug,
        period_start: periodStart.toISOString(),
        stripe_subscription_id: subscription.id,
      },
    });
  }
}

async function readSubscriptionMetadata(
  subscription: string | Stripe.Subscription,
): Promise<{ organizationId: string | null; planSlug: string | null }> {
  if (typeof subscription === 'string') {
    const fetched = await getStripeClient().subscriptions.retrieve(subscription);
    return {
      organizationId: (fetched.metadata?.organization_id as string | undefined) ?? null,
      planSlug: (fetched.metadata?.plan_slug as string | undefined) ?? null,
    };
  }
  return {
    organizationId: (subscription.metadata?.organization_id as string | undefined) ?? null,
    planSlug: (subscription.metadata?.plan_slug as string | undefined) ?? null,
  };
}

function stripeTimestampToDate(unix: number): Date {
  return new Date(unix * 1000);
}

function mapStripeStatus(
  status: Stripe.Subscription.Status,
): 'active' | 'trialing' | 'past_due' | 'canceled' | 'unbilled' {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
    default:
      return 'unbilled';
  }
}
