import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getStripeClient } from './client';

const { organizationSubscriptions } = schema;

/**
 * Create a Stripe Customer Portal session — Stripe-hosted UI where the user
 * can update card, cancel, change plan, view invoices. We give them this
 * instead of building our own subscription management UI for PR 2.
 *
 * Requires the org to already have a `stripe_customer_id` (i.e. they've
 * completed Checkout at least once). Throws otherwise — the caller should
 * hide the "Manage subscription" button for orgs without a customer record.
 */
export async function createCustomerPortalSession(args: {
  db: DB;
  organizationId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const { db, organizationId, returnUrl } = args;
  const stripe = getStripeClient();

  const rows = await db
    .select({ customerId: organizationSubscriptions.stripeCustomerId })
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: 'no Stripe customer linked to this organization',
      fix: 'Upgrade to a paid plan first; the portal is only available for billed orgs.',
    });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}
