import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

const { billingPlans, organizationSubscriptions } = schema;

export type PlanFeatures = {
  maxConnectors: number | null;
  /** Ceiling on rows in the `chunks` table (= embedding vectors stored).
   *  `null` = unlimited. Closes the downgrade loophole — new ingestion is
   *  paused at the cap, existing chunks remain queryable. */
  maxStoredChunks?: number | null;
  syncIntervalTier?: 'standard' | 'priority';
  sampleDataIncluded?: boolean;
};

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  monthlyCredits: number;
  monthlyPriceCents: number;
  /** Annual list price (charged upfront). `null` means this plan doesn't
   *  offer annual billing. The credit grant on annual is 12 × monthlyCredits
   *  issued at the start of each annual period. */
  annualPriceCents: number | null;
  features: PlanFeatures;
  isPublic: boolean;
}

export interface SubscriptionWithPlan {
  organizationId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unbilled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  /** Free-trial expiry (RFC 0010 / ADR 0007 — W3). NULL for grandfathered
   *  orgs that signed up before the trial mechanic, or for paid customers. */
  trialEndsAt: Date | null;
  /** Stripe subscription id when the org has converted to a paid plan. */
  stripeSubscriptionId: string | null;
  plan: PlanRow;
}

/**
 * Derived trial state for the dashboard banner + bot/agent gates.
 *
 *   - `none`    — grandfathered org with no trial (trial_ends_at IS NULL on
 *                 the legacy free tier).
 *   - `active`  — within the trial window, on the free plan, no paid sub.
 *   - `expired` — trial_ends_at is in the past, still on free, no paid sub.
 *                 Once existing credits run out, pool-exhaustion guard kicks
 *                 in (B4) and refuses new ops.
 *   - `paid`    — converted to a paid Stripe subscription; trial irrelevant.
 */
export type TrialState =
  | { kind: 'none' }
  | { kind: 'active'; endsAt: Date; daysRemaining: number }
  | { kind: 'expired'; endsAt: Date }
  | { kind: 'paid' };

export function deriveTrialState(sub: SubscriptionWithPlan | null, now: Date = new Date()): TrialState {
  if (!sub) return { kind: 'none' };
  if (sub.stripeSubscriptionId) return { kind: 'paid' };
  if (sub.plan.slug !== 'free') return { kind: 'paid' };
  if (!sub.trialEndsAt) return { kind: 'none' };
  if (sub.trialEndsAt <= now) return { kind: 'expired', endsAt: sub.trialEndsAt };
  const msRemaining = sub.trialEndsAt.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  return { kind: 'active', endsAt: sub.trialEndsAt, daysRemaining };
}

/** Look up an organisation's current subscription joined with its plan. */
export async function getCurrentSubscription(
  db: DB,
  organizationId: string,
): Promise<SubscriptionWithPlan | null> {
  const rows = await db
    .select({
      organizationId: organizationSubscriptions.organizationId,
      status: organizationSubscriptions.status,
      currentPeriodStart: organizationSubscriptions.currentPeriodStart,
      currentPeriodEnd: organizationSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: organizationSubscriptions.cancelAtPeriodEnd,
      trialEndsAt: organizationSubscriptions.trialEndsAt,
      stripeSubscriptionId: organizationSubscriptions.stripeSubscriptionId,
      planId: billingPlans.id,
      slug: billingPlans.slug,
      name: billingPlans.name,
      monthlyCredits: billingPlans.monthlyCredits,
      monthlyPriceCents: billingPlans.monthlyPriceCents,
      annualPriceCents: billingPlans.annualPriceCents,
      features: billingPlans.features,
      isPublic: billingPlans.isPublic,
    })
    .from(organizationSubscriptions)
    .innerJoin(billingPlans, eq(organizationSubscriptions.planId, billingPlans.id))
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    organizationId: row.organizationId,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    trialEndsAt: row.trialEndsAt,
    stripeSubscriptionId: row.stripeSubscriptionId,
    plan: {
      id: row.planId,
      slug: row.slug,
      name: row.name,
      monthlyCredits: Number(row.monthlyCredits),
      monthlyPriceCents: row.monthlyPriceCents,
      annualPriceCents: row.annualPriceCents,
      features: row.features as PlanFeatures,
      isPublic: row.isPublic,
    },
  };
}

/** List public plans for the settings/billing plan-grid UI. */
export async function listPublicPlans(db: DB): Promise<PlanRow[]> {
  const rows = await db
    .select()
    .from(billingPlans)
    .where(eq(billingPlans.isPublic, true));
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    monthlyCredits: Number(row.monthlyCredits),
    monthlyPriceCents: row.monthlyPriceCents,
    annualPriceCents: row.annualPriceCents,
    features: row.features as PlanFeatures,
    isPublic: row.isPublic,
  }));
}
