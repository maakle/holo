import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { billingEnabled } from './env';
import { getOrgBalance } from './ledger';
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

export interface CreditPoolDecision {
  allowed: boolean;
  /** Current org balance in credits (may be 0 or negative). */
  balance: number;
}

/**
 * Returns whether the org has any credits left to spend. Cheap (~1 SQL
 * aggregate). Use this for soft checks — e.g. UI banners showing "low on
 * credits" — when you don't want to throw.
 *
 * When billing is disabled (`HOLO_BILLING_ENABLED=false`), this always
 * returns `{ allowed: true }` so self-hosted installs are unconstrained.
 */
export async function checkCreditPool(
  db: DB,
  organizationId: string,
): Promise<CreditPoolDecision> {
  if (!billingEnabled()) return { allowed: true, balance: Number.POSITIVE_INFINITY };
  const { balance } = await getOrgBalance(db, organizationId);
  return { allowed: balance > 0, balance };
}

/**
 * Throwing variant — refuses to start an LLM call, agent run, or sync run
 * when the org has no credits left to spend. Call this at every entry point
 * that would write a debit:
 *
 *   - `apps/web/src/app/api/chat/route.ts` (dashboard chat)
 *   - `apps/worker/src/slack-bot/agent-events.ts` (Slack bot agent)
 *   - `apps/worker/src/queues/sync-processor-base.ts` (connector sync jobs)
 *
 * The thrown `HOLO_CREDIT_POOL_EXHAUSTED` error includes a buy-credits CTA
 * in `fix` so callers can surface it as-is to the end user. Existing in-flight
 * operations aren't interrupted — they finish and write their final debit,
 * which may briefly push the balance further negative; the next attempt is
 * what gets blocked. This keeps the implementation simple (no mid-operation
 * cancellation) while still giving customers a clear stop signal.
 *
 * RFC 0010 / ADR 0007.
 */
export async function assertSufficientCredits(
  db: DB,
  organizationId: string,
): Promise<void> {
  const decision = await checkCreditPool(db, organizationId);
  if (decision.allowed) return;
  throw holoError({
    code: ErrorCode.HOLO_CREDIT_POOL_EXHAUSTED,
    problem: 'workspace is out of credits',
    fix: 'Buy a top-up at /settings/billing or upgrade your plan to restore service.',
  });
}
