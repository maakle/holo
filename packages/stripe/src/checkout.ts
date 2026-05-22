import { eq, and } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getStripeClient } from './client';
import { ensureStripeCustomerForOrg } from './customers';

const { billingPlans, creditTopupPackages } = schema;

/**
 * Create a Stripe Checkout Session for upgrading an org to a paid plan.
 * Returns a URL the caller redirects the user to. Stripe handles card entry,
 * tax, and 3DS; on completion the `checkout.session.completed` webhook
 * fires and our handler swaps the org's plan + writes the first grant.
 *
 * Free / enterprise plans throw — the free tier is the default and
 * enterprise is sales-led (no self-serve checkout).
 */
export async function createCheckoutSessionForPlan(args: {
  db: DB;
  organizationId: string;
  planSlug: string;
  /** 'monthly' bills `monthlyPriceCents` every month. 'annual' bills
   *  `annualPriceCents` upfront for the whole year (~15% off list) and
   *  the webhook handler grants 12× monthlyCredits at the start of each
   *  annual period. */
  billingInterval: 'monthly' | 'annual';
  ownerEmail: string;
  /** Where Stripe sends the user after a successful charge.
   *  Use a server-side route that polls until the webhook has updated state,
   *  then redirects to /settings/billing — Stripe's redirect can beat the
   *  webhook by a few hundred ms. */
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const { db, organizationId, planSlug, billingInterval, ownerEmail, successUrl, cancelUrl } = args;
  const stripe = getStripeClient();

  const planRows = await db
    .select()
    .from(billingPlans)
    .where(eq(billingPlans.slug, planSlug))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `plan '${planSlug}' not found`,
      fix: 'Check the plan slug. Valid slugs: starter, team, scale, business.',
    });
  }
  const priceId =
    billingInterval === 'annual' ? plan.stripeAnnualPriceId : plan.stripePriceId;
  const intervalAmount =
    billingInterval === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents;
  if (!intervalAmount || intervalAmount <= 0 || !priceId) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `plan '${planSlug}' has no ${billingInterval} price configured`,
      fix:
        billingInterval === 'annual'
          ? 'This plan is monthly-only today. Pick a different plan or contact sales.'
          : 'Free and Enterprise plans are not self-serve. Pick Starter / Team / Scale / Business.',
    });
  }

  const customerId = await ensureStripeCustomerForOrg({
    db,
    organizationId,
    ownerEmail,
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    // Carry the org id + target plan into metadata so the webhook handler
    // can route the event back to the right org / plan without an extra
    // round-trip. Stripe surfaces metadata on both Session and Subscription.
    metadata: {
      organization_id: organizationId,
      plan_slug: planSlug,
      billing_interval: billingInterval,
    },
    subscription_data: {
      metadata: {
        organization_id: organizationId,
        plan_slug: planSlug,
        billing_interval: billingInterval,
      },
    },
  });

  if (!session.url) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Stripe checkout session returned without a redirect URL',
      fix: 'Retry the upgrade. If it persists, check Stripe API status.',
    });
  }

  return { url: session.url, sessionId: session.id };
}

/**
 * Create a one-shot Stripe Checkout Session for a credit top-up. Returns a
 * URL the caller redirects the user to. RFC 0010 / ADR 0007.
 *
 * Top-ups are `mode: 'payment'` (not subscription) — Stripe charges the card
 * once and fires `checkout.session.completed`. The webhook handler reads
 * `metadata.topup_package_slug`, looks up the credit amount, and writes a
 * `topup` row to `credit_ledger` so the balance increments.
 *
 * Idempotency: every Checkout Session has a unique `cs_*` id which the
 * webhook handler uses to derive the ledger row's idempotency key. Stripe's
 * at-least-once delivery is fine — duplicates collapse on the unique key.
 */
export async function createCheckoutSessionForTopup(args: {
  db: DB;
  organizationId: string;
  packageSlug: string;
  ownerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const { db, organizationId, packageSlug, ownerEmail, successUrl, cancelUrl } = args;
  const stripe = getStripeClient();

  const packageRows = await db
    .select()
    .from(creditTopupPackages)
    .where(
      and(
        eq(creditTopupPackages.slug, packageSlug),
        eq(creditTopupPackages.isActive, true),
      ),
    )
    .limit(1);
  const pkg = packageRows[0];
  if (!pkg) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `top-up package '${packageSlug}' not found or inactive`,
      fix: 'Check the package slug. Valid slugs: topup-small, topup-medium, topup-large.',
    });
  }
  if (!pkg.stripePriceId) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `top-up package '${packageSlug}' has no Stripe price yet`,
      fix: 'Wait for the next worker boot — provisioning will create the Stripe price.',
    });
  }

  const customerId = await ensureStripeCustomerForOrg({
    db,
    organizationId,
    ownerEmail,
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: pkg.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    metadata: {
      organization_id: organizationId,
      topup_package_slug: pkg.slug,
      topup_credits: String(pkg.credits),
    },
    payment_intent_data: {
      metadata: {
        organization_id: organizationId,
        topup_package_slug: pkg.slug,
        topup_credits: String(pkg.credits),
      },
    },
  });

  if (!session.url) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Stripe checkout session returned without a redirect URL',
      fix: 'Retry the purchase. If it persists, check Stripe API status.',
    });
  }

  return { url: session.url, sessionId: session.id };
}
