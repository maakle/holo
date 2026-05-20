import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { billingEnabled } from './env';
import { getCurrentSubscription } from './plans';

const { connectorCredentials } = schema;

export type ConnectorGateDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'plan_limit';
      currentPlanSlug: string;
      currentPlanName: string;
      limit: number;
      currentCount: number;
      /** Slug of the lowest plan that lifts this limit; the upgrade modal
       *  uses it to deep-link to the right tile on /settings/billing. */
      suggestedUpgradeSlug: string;
    };

/**
 * Decide whether the org can add a connector for `provider` under their
 * current plan. Called from every OAuth-start / connector-install entry
 * point. The Star Wars sample dataset is exempt by data shape (it lives in
 * `sources` with `metadata.sample = true`, never in `connector_credentials`).
 *
 * Re-authenticating an already-connected provider is always allowed (count
 * doesn't increase) — only NEW provider connections beyond the plan limit
 * are blocked. We count DISTINCT providers so multiple per-user installs
 * of the same provider (e.g. two Slack users) collapse to one "connector."
 *
 * When billing is disabled (`HOLO_BILLING_ENABLED=false`), this always
 * returns `allowed: true` so self-hosted installs are unconstrained.
 */
export async function canAddConnector(
  db: DB,
  organizationId: string,
  provider?: string,
): Promise<ConnectorGateDecision> {
  if (!billingEnabled()) return { allowed: true };
  const sub = await getCurrentSubscription(db, organizationId);
  if (!sub) return { allowed: true };
  const limit = sub.plan.features.maxConnectors;
  if (limit === null) return { allowed: true };

  const distinctProvidersRows = await db
    .select({ provider: connectorCredentials.provider })
    .from(connectorCredentials)
    .where(
      and(
        eq(connectorCredentials.organizationId, organizationId),
        eq(connectorCredentials.status, 'active'),
      ),
    );
  const distinct = new Set<string>(distinctProvidersRows.map((r) => r.provider));
  // Re-auth of an existing provider doesn't move the needle.
  if (provider && distinct.has(provider)) return { allowed: true };
  if (distinct.size < limit) return { allowed: true };

  return {
    allowed: false,
    reason: 'plan_limit',
    currentPlanSlug: sub.plan.slug,
    currentPlanName: sub.plan.name,
    limit,
    currentCount: distinct.size,
    suggestedUpgradeSlug: sub.plan.slug === 'free' ? 'starter' : 'team',
  };
}
