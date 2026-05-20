import { eq, isNull } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { getStripeClient } from './client';

const { billingPlans } = schema;

/**
 * Idempotently sync every `billing_plans` row into Stripe as a Product + a
 * monthly recurring Price. Writes the resulting `price_*` id back into
 * `billing_plans.stripe_price_id` so checkout can reference it.
 *
 * Runs once per worker boot (idempotent via the Stripe `lookup_key` matching
 * `billingPlans.slug`). Cheap when nothing has changed; only writes to Stripe
 * when a price doesn't already exist for a plan.
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

    // 1. Find an existing Stripe Price by lookup_key (= plan slug). Stripe
    //    treats lookup_key as a stable handle, so a redeploy that lost the
    //    DB cell can still find the Price it already created.
    const existing = await stripe.prices.list({
      lookup_keys: [plan.slug],
      active: true,
      limit: 1,
    });

    let priceId: string;
    if (existing.data.length > 0) {
      priceId = existing.data[0]!.id;
    } else {
      // 2. Create Product + Price as a single graph. Stripe's API requires
      //    the Product to exist first, but the Price create accepts an
      //    inline `product_data` shortcut.
      const price = await stripe.prices.create({
        currency: 'usd',
        unit_amount: plan.monthlyPriceCents,
        recurring: { interval: 'month' },
        lookup_key: plan.slug,
        product_data: {
          name: `Holo — ${plan.name}`,
          metadata: { plan_slug: plan.slug },
        },
        metadata: { plan_slug: plan.slug },
      });
      priceId = price.id;
    }

    await db
      .update(billingPlans)
      .set({ stripePriceId: priceId })
      .where(eq(billingPlans.id, plan.id));
    provisioned += 1;
  }

  return { provisioned, skipped };
}
