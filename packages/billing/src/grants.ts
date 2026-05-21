import { lt, eq, sql, and, isNull, or, gt } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { billingEnabled } from './env';
import { writeLedgerEntry } from './ledger';

const { billingPlans, organizationSubscriptions } = schema;

/**
 * Issue the initial credit grant for a freshly-created organisation. Called
 * from the Better Auth user/org create hook so a new signup lands with a
 * non-zero balance and the settings/billing page shows live data
 * immediately.
 *
 * Idempotency key 'seed:initial:<org_id>' matches the migration backfill;
 * if migration 0059 already seeded the org, this is a no-op.
 */
export async function seedInitialSubscriptionAndGrant(
  db: DB,
  organizationId: string,
): Promise<void> {
  if (!billingEnabled()) return;

  // 1. Ensure an organization_subscriptions row exists on the free plan.
  const freePlan = await db
    .select()
    .from(billingPlans)
    .where(eq(billingPlans.slug, 'free'))
    .limit(1);
  if (freePlan.length === 0) return; // Migration not yet applied — bail.
  const plan = freePlan[0]!;

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  // Every new org gets a 14-day trial. Existing orgs grandfathered via the
  // migration (trial_ends_at = NULL) stay on the legacy forever-free tier.
  // RFC 0010 / ADR 0007.
  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  await db
    .insert(organizationSubscriptions)
    .values({
      organizationId,
      planId: plan.id,
      status: 'trialing',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEndsAt,
    })
    .onConflictDoNothing({ target: organizationSubscriptions.organizationId });

  // 2. Issue the initial grant. ON CONFLICT covers migration-backfilled rows.
  if (Number(plan.monthlyCredits) > 0) {
    await writeLedgerEntry(db, {
      organizationId,
      kind: 'grant',
      credits: Number(plan.monthlyCredits),
      reason: 'monthly_grant',
      referenceKind: 'subscription',
      referenceId: organizationId,
      idempotencyKey: `seed:initial:${organizationId}`,
      metadata: { plan_slug: plan.slug, period_start: periodStart.toISOString() },
    });
  }
}

/**
 * Renew any subscriptions whose `current_period_end` has passed: advance the
 * period and write a fresh `grant` ledger row.
 *
 * In PR 1 this is driven by a worker cron (`billing-grants` queue). PR 2
 * replaces the cron with Stripe's `invoice.payment_succeeded` webhook
 * handler, which calls the same function with the period derived from
 * Stripe's invoice payload.
 *
 * Idempotency key shape: `grant:<org_id>:<period_start_iso>`. A double-run
 * of the cron writes once.
 */
export async function processExpiredPeriods(db: DB): Promise<number> {
  if (!billingEnabled()) return 0;

  const now = new Date();
  // Skip Stripe-managed subscriptions: their period rollover + grant is
  // driven by the `invoice.payment_succeeded` webhook in packages/stripe,
  // not by the cron. The cron is the source of truth for free-tier orgs
  // and any plan that doesn't have a Stripe subscription cached yet.
  const due = await db
    .select({
      organizationId: organizationSubscriptions.organizationId,
      currentPeriodEnd: organizationSubscriptions.currentPeriodEnd,
      planId: organizationSubscriptions.planId,
      monthlyCredits: billingPlans.monthlyCredits,
      planSlug: billingPlans.slug,
    })
    .from(organizationSubscriptions)
    .innerJoin(billingPlans, eq(organizationSubscriptions.planId, billingPlans.id))
    .where(
      and(
        lt(organizationSubscriptions.currentPeriodEnd, now),
        isNull(organizationSubscriptions.stripeSubscriptionId),
        // Skip orgs whose trial has expired — they shouldn't get fresh
        // monthly credits. Grandfathered (trial_ends_at = NULL) and
        // still-trialing orgs continue to receive grants.
        or(
          isNull(organizationSubscriptions.trialEndsAt),
          gt(organizationSubscriptions.trialEndsAt, now),
        ),
      ),
    );

  let processed = 0;
  for (const row of due) {
    const newStart = row.currentPeriodEnd;
    const newEnd = new Date(
      Date.UTC(
        newStart.getUTCFullYear(),
        newStart.getUTCMonth() + 1,
        newStart.getUTCDate(),
        newStart.getUTCHours(),
        newStart.getUTCMinutes(),
        newStart.getUTCSeconds(),
      ),
    );
    await db
      .update(organizationSubscriptions)
      .set({
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        updatedAt: now,
      })
      .where(eq(organizationSubscriptions.organizationId, row.organizationId));

    if (Number(row.monthlyCredits) > 0) {
      await writeLedgerEntry(db, {
        organizationId: row.organizationId,
        kind: 'grant',
        credits: Number(row.monthlyCredits),
        reason: 'monthly_grant',
        referenceKind: 'subscription',
        referenceId: row.organizationId,
        idempotencyKey: `grant:${row.organizationId}:${newStart.toISOString()}`,
        metadata: { plan_slug: row.planSlug, period_start: newStart.toISOString() },
      });
    }
    processed += 1;
  }
  return processed;
}

/**
 * Write expiry debits for any topup grants whose `expires_at` has passed.
 * No-op in PR 1 because topups don't exist yet — wired so PR 2 can ship
 * topups without revisiting the cron infra.
 */
export async function processExpiredTopups(db: DB): Promise<number> {
  if (!billingEnabled()) return 0;
  // Find topup grants whose expiry has passed and whose expiry hasn't been
  // recorded yet. Idempotency key 'expiry:<topup_grant_id>'.
  const rows = await db.execute<{
    id: string;
    organization_id: string;
    credits: string | number;
  }>(sql`
    SELECT id, organization_id, credits
    FROM credit_ledger
    WHERE kind = 'topup'
      AND expires_at IS NOT NULL
      AND expires_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM credit_ledger e
        WHERE e.kind = 'expiry'
          AND e.idempotency_key = 'expiry:' || credit_ledger.id::text
      )
  `);
  const list =
    ((rows as { rows?: unknown[] }).rows ?? (rows as unknown[])) as Array<{
      id: string;
      organization_id: string;
      credits: string | number;
    }>;
  for (const row of list) {
    await writeLedgerEntry(db, {
      organizationId: row.organization_id,
      kind: 'expiry',
      credits: -Math.abs(Number(row.credits)),
      reason: 'expiry',
      referenceKind: 'manual',
      referenceId: row.id,
      idempotencyKey: `expiry:${row.id}`,
      metadata: { source_topup_id: row.id },
    });
  }
  return list.length;
}
