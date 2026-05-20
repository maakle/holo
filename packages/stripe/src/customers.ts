import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getStripeClient } from './client';

const { organization, organizationSubscriptions } = schema;

/**
 * Ensure the org has a Stripe customer record. Returns the `cus_*` id.
 * Idempotent: if `organization_subscriptions.stripe_customer_id` is already
 * set we trust it; otherwise we create a Customer in Stripe, cache the id,
 * and return.
 *
 * `ownerEmail` is the email Stripe will use for receipts. We pass the org
 * owner (or the user driving the upgrade) — Customer Portal lets them edit
 * it later.
 */
export async function ensureStripeCustomerForOrg(args: {
  db: DB;
  organizationId: string;
  ownerEmail: string;
}): Promise<string> {
  const { db, organizationId, ownerEmail } = args;
  const stripe = getStripeClient();

  const subRows = await db
    .select({
      stripeCustomerId: organizationSubscriptions.stripeCustomerId,
    })
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  const existing = subRows[0]?.stripeCustomerId;
  if (existing) return existing;

  // Pull org name for the Customer description.
  const orgRows = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (orgRows.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `organization ${organizationId} not found`,
      fix: 'Confirm the active organisation before initiating Stripe checkout.',
    });
  }

  const customer = await stripe.customers.create({
    email: ownerEmail,
    name: orgRows[0]!.name,
    metadata: { organization_id: organizationId },
  });

  await db
    .update(organizationSubscriptions)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(organizationSubscriptions.organizationId, organizationId));

  return customer.id;
}
