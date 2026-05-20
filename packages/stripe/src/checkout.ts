import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getStripeClient } from './client';
import { ensureStripeCustomerForOrg } from './customers';

const { billingPlans } = schema;

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
  ownerEmail: string;
  /** Where Stripe sends the user after a successful charge.
   *  Use a server-side route that polls until the webhook has updated state,
   *  then redirects to /settings/billing — Stripe's redirect can beat the
   *  webhook by a few hundred ms. */
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const { db, organizationId, planSlug, ownerEmail, successUrl, cancelUrl } = args;
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
      fix: 'Check the plan slug. Valid slugs: starter, team, business.',
    });
  }
  if (plan.monthlyPriceCents <= 0 || !plan.stripePriceId) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `plan '${planSlug}' is not purchasable via checkout`,
      fix: 'Free and Enterprise plans are not self-serve. Pick Starter / Team / Business.',
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
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    // Carry the org id + target plan into metadata so the webhook handler
    // can route the event back to the right org / plan without an extra
    // round-trip. Stripe surfaces metadata on both Session and Subscription.
    metadata: {
      organization_id: organizationId,
      plan_slug: planSlug,
    },
    subscription_data: {
      metadata: {
        organization_id: organizationId,
        plan_slug: planSlug,
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
