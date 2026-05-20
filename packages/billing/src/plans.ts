import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

const { billingPlans, organizationSubscriptions } = schema;

export type PlanFeatures = {
  maxConnectors: number | null;
  syncIntervalTier?: 'standard' | 'priority';
  sampleDataIncluded?: boolean;
};

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  monthlyCredits: number;
  monthlyPriceCents: number;
  features: PlanFeatures;
  isPublic: boolean;
}

export interface SubscriptionWithPlan {
  organizationId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unbilled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  plan: PlanRow;
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
      planId: billingPlans.id,
      slug: billingPlans.slug,
      name: billingPlans.name,
      monthlyCredits: billingPlans.monthlyCredits,
      monthlyPriceCents: billingPlans.monthlyPriceCents,
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
    plan: {
      id: row.planId,
      slug: row.slug,
      name: row.name,
      monthlyCredits: Number(row.monthlyCredits),
      monthlyPriceCents: row.monthlyPriceCents,
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
    features: row.features as PlanFeatures,
    isPublic: row.isPublic,
  }));
}
