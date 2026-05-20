import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  billingEnabled,
  getCurrentSubscription,
  getOrgBalance,
  getCurrentPeriodUsage,
  listPublicPlans,
  recentLedgerActivity,
  type SubscriptionWithPlan,
  type PlanRow,
  type LedgerActivityRow,
} from '@holo/billing';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { BillingDisabled } from './_components/billing-disabled';
import { PlanSummary } from './_components/plan-summary';
import { BalanceCard } from './_components/balance-card';
import { UsageBreakdown } from './_components/usage-breakdown';
import { PlanGrid } from './_components/plan-grid';
import { LedgerTable } from './_components/ledger-table';

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ upgrade?: string }>;
}) {
  if (!billingEnabled()) {
    return <BillingDisabled />;
  }

  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/billing');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

  const [subscription, balance, period, plans, activity, sp] = await Promise.all([
    getCurrentSubscription(db, orgId),
    getOrgBalance(db, orgId),
    getCurrentPeriodUsage(db, orgId),
    listPublicPlans(db),
    recentLedgerActivity(db, orgId, 50),
    searchParams,
  ]);

  return (
    <div className="space-y-10">
      <PlanSummary subscription={subscription} highlightUpgrade={sp.upgrade} />
      <BalanceCard
        balance={balance.balance}
        monthlyGrant={subscription?.plan.monthlyCredits ?? 0}
        debitsThisPeriod={period.total}
      />
      <UsageBreakdown
        llmCredits={period.llmCredits}
        syncCredits={period.syncCredits}
      />
      <PlanGrid
        plans={plans satisfies PlanRow[]}
        currentSlug={subscription?.plan.slug ?? null}
        highlightSlug={sp.upgrade ?? null}
      />
      <LedgerTable rows={activity satisfies LedgerActivityRow[]} />
    </div>
  );
}

// Suppress TS unused-import noise for type re-exports above; they're used to
// constrain the satisfies clauses.
export type { SubscriptionWithPlan };
