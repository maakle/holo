import { eq, isNull } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { getStripeClient } from './client';
import type { StripeClient } from './types';

const { billingPlans, creditTopupPackages } = schema;

/**
 * Find an existing active Stripe Price under `lookup_key` whose `unit_amount`
 * matches `unitAmount`. If none matches, archive any stale active prices under
 * the same lookup_key (Stripe requires lookup_keys to be unique among active
 * prices) and create a fresh Price + Product graph.
 *
 * Re-pricing safety: existing customer subscriptions reference Prices by ID,
 * not by `lookup_key`, so billing for grandfathered customers is unaffected
 * by anything we do here. Stripe blocks archiving a Price that's the
 * `default_price` of its Product (the common case for the first generation
 * of plan rows), so instead of archiving we **rename the stale Price's
 * `lookup_key`** to free the canonical slug for the new Price. The stale
 * Price stays `active=true` — harmless because nothing references it by
 * lookup_key any more, and future provisioning runs won't find it.
 *
 * `recurring` is passed through to support both monthly subscriptions (plans)
 * and one-shot purchases (top-ups). Set `recurring: null` for one-shot.
 */
async function findOrCreatePrice(
  stripe: StripeClient,
  args: {
    lookupKey: string;
    unitAmount: number;
    productName: string;
    metadata: Record<string, string>;
    recurring: { interval: 'month' } | null;
  },
): Promise<string> {
  const existing = await stripe.prices.list({
    lookup_keys: [args.lookupKey],
    active: true,
    limit: 1,
  });

  const matchingPrice = existing.data.find((p) => p.unit_amount === args.unitAmount);
  if (matchingPrice) return matchingPrice.id;

  for (const stale of existing.data) {
    await stripe.prices.update(stale.id, {
      lookup_key: `${stale.lookup_key ?? args.lookupKey}-superseded-${Date.now()}`,
    });
  }
  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: args.unitAmount,
    ...(args.recurring ? { recurring: args.recurring } : {}),
    lookup_key: args.lookupKey,
    product_data: {
      name: args.productName,
      metadata: args.metadata,
    },
    metadata: args.metadata,
  });
  return price.id;
}

/**
 * Idempotently sync every `billing_plans` row into Stripe as a Product + a
 * monthly recurring Price. Writes the resulting `price_*` id back into
 * `billing_plans.stripe_price_id` so checkout can reference it.
 *
 * Runs once per worker boot (idempotent via the Stripe `lookup_key` matching
 * `billingPlans.slug`). Cheap when nothing has changed; only writes to Stripe
 * when a price doesn't already exist for a plan or its amount has drifted.
 *
 * Skips:
 *   - Plans with `monthly_price_cents = 0` (free / enterprise tier — no
 *     Stripe product needed; free is the default subscription, enterprise
 *     is sales-led)
 *   - Plans whose `stripe_price_id` is already set
 */
export async function ensureStripeProductsForPlans(db: DB): Promise<{
  provisioned: number;
  skipped: number;
}> {
  const stripe = getStripeClient();
  const plans = await db.select().from(billingPlans).where(isNull(billingPlans.stripePriceId));
  let provisioned = 0;
  let skipped = 0;

  for (const plan of plans) {
    if (plan.monthlyPriceCents <= 0) {
      skipped += 1;
      continue;
    }

    const priceId = await findOrCreatePrice(stripe, {
      lookupKey: plan.slug,
      unitAmount: plan.monthlyPriceCents,
      productName: `Holo — ${plan.name}`,
      metadata: { plan_slug: plan.slug },
      recurring: { interval: 'month' },
    });

    await db
      .update(billingPlans)
      .set({ stripePriceId: priceId })
      .where(eq(billingPlans.id, plan.id));
    provisioned += 1;
  }

  return { provisioned, skipped };
}

/**
 * Provision a Stripe Product + one-shot Price for every `credit_topup_packages`
 * row that hasn't been provisioned yet. Top-ups are NOT recurring — they're
 * `payment_intent.succeeded` events, not subscriptions. RFC 0010 / ADR 0007.
 */
export async function ensureStripeProductsForTopupPackages(db: DB): Promise<{
  provisioned: number;
  skipped: number;
}> {
  const stripe = getStripeClient();
  const packages = await db
    .select()
    .from(creditTopupPackages)
    .where(isNull(creditTopupPackages.stripePriceId));

  let provisioned = 0;
  let skipped = 0;

  for (const pkg of packages) {
    if (!pkg.isActive || pkg.priceCents <= 0) {
      skipped += 1;
      continue;
    }

    const priceId = await findOrCreatePrice(stripe, {
      lookupKey: pkg.slug,
      unitAmount: pkg.priceCents,
      productName: `Holo — ${pkg.name}`,
      metadata: { topup_package_slug: pkg.slug },
      recurring: null,
    });

    await db
      .update(creditTopupPackages)
      .set({ stripePriceId: priceId })
      .where(eq(creditTopupPackages.id, pkg.id));
    provisioned += 1;
  }

  return { provisioned, skipped };
}
