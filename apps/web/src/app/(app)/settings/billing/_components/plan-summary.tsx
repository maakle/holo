import type { SubscriptionWithPlan } from '@holo/billing';
import { ManageSubscriptionButton } from './manage-subscription-button';

interface Props {
  subscription: SubscriptionWithPlan | null;
  /** True when the org has a `stripe_customer_id`. Controls whether to render
   *  the "Manage subscription" button (Stripe Customer Portal). */
  hasStripeCustomer: boolean;
  highlightUpgrade?: string;
  checkoutFlash?: 'success' | 'cancel';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PlanSummary({
  subscription,
  hasStripeCustomer,
  highlightUpgrade,
  checkoutFlash,
}: Props) {
  return (
    <header className="space-y-3">
      <h2 className="font-display text-h2 font-semibold tracking-tight">
        Billing
      </h2>
      <p className="text-[15px] leading-6 text-text-muted">
        One workspace, one shared credit pool. Each tier comes with a monthly
        grant; buy a top-up any time to add more credits without changing
        plans.
      </p>

      {checkoutFlash === 'success' ? (
        <div className="mt-4 rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-4 py-3 text-[13px] text-text">
          Upgrade complete. Your new plan credits land within a minute (after
          Stripe confirms the charge).
        </div>
      ) : null}
      {checkoutFlash === 'cancel' ? (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
          Upgrade cancelled. You're still on the {subscription?.plan.name ?? 'current'} plan.
        </div>
      ) : null}

      {subscription ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-[13px] tabular-nums">
          <span className="font-medium text-text">{subscription.plan.name}</span>
          <span className="text-text-subtle">·</span>
          <span className="text-text-muted">
            {subscription.plan.features.maxConnectors === null
              ? 'Unlimited connectors'
              : `${subscription.plan.features.maxConnectors} connector${subscription.plan.features.maxConnectors === 1 ? '' : 's'}`}
          </span>
          <span className="text-text-subtle">·</span>
          <span className="text-text-muted">
            Period {formatDate(subscription.currentPeriodStart)} →{' '}
            {formatDate(subscription.currentPeriodEnd)}
          </span>
          <span className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] uppercase tracking-[0.04em] text-text-muted">
            {subscription.status}
          </span>
          {hasStripeCustomer ? (
            <div className="ml-auto">
              <ManageSubscriptionButton />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
          No subscription found for this workspace. The free plan will be
          created automatically on next sign-in.
        </div>
      )}

      {highlightUpgrade ? (
        <p className="text-[13px] text-text-muted">
          You came here from the upgrade prompt. Pick a paid tier below to
          continue.
        </p>
      ) : null}
    </header>
  );
}
