import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { schema } from '@holo/db';
import {
  billingEnabled,
  getCurrentSubscription,
  getOrgBalance,
  getCurrentPeriodUsage,
  listPublicPlans,
  listActiveTopupPackages,
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
import { TopupCard } from './_components/topup-card';
import { LedgerTable } from './_components/ledger-table';
import { TopupFlash } from './_components/topup-flash';

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ upgrade?: string; checkout?: string; topup?: string }>;
}) {
  if (!billingEnabled()) {
    return <BillingDisabled />;
  }

  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/billing');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

  const [subscription, balance, period, plans, topupPackages, activity, sp, customerRow] =
    await Promise.all([
      getCurrentSubscription(db, orgId),
      getOrgBalance(db, orgId),
      getCurrentPeriodUsage(db, orgId),
      listPublicPlans(db),
      listActiveTopupPackages(db),
      recentLedgerActivity(db, orgId, 50),
      searchParams,
      db
        .select({ stripeCustomerId: schema.organizationSubscriptions.stripeCustomerId })
        .from(schema.organizationSubscriptions)
        .where(eq(schema.organizationSubscriptions.organizationId, orgId))
        .limit(1),
    ]);

  const hasStripeCustomer = Boolean(customerRow[0]?.stripeCustomerId);
  const checkoutFlash: 'success' | 'cancel' | undefined =
    sp.checkout === 'success' ? 'success' : sp.checkout === 'cancel' ? 'cancel' : undefined;
  const topupFlash: 'success' | 'cancel' | undefined =
    sp.topup === 'success' ? 'success' : sp.topup === 'cancel' ? 'cancel' : undefined;

  return (
    <div className="space-y-10">
      <PlanSummary
        subscription={subscription}
        hasStripeCustomer={hasStripeCustomer}
        highlightUpgrade={sp.upgrade}
        checkoutFlash={checkoutFlash}
      />
      <TopupFlash flash={topupFlash} />
      <BalanceCard
        balance={balance.balance}
        monthlyGrant={subscription?.plan.monthlyCredits ?? 0}
        debitsThisPeriod={period.total}
      />
      <TopupCard packages={topupPackages} />
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
