import type { SubscriptionWithPlan } from '@holo/billing';

interface Props {
  subscription: SubscriptionWithPlan | null;
  highlightUpgrade?: string;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PlanSummary({ subscription, highlightUpgrade }: Props) {
  return (
    <header className="space-y-3">
      <h2 className="font-display text-h2 font-semibold tracking-tight">
        Billing
      </h2>
      <p className="text-[15px] leading-6 text-text-muted">
        Holo charges by usage — chat turns and ingested artifacts both burn
        credits from your monthly grant.
      </p>

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
          <span className="ml-auto inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] uppercase tracking-[0.04em] text-text-muted">
            {subscription.status}
          </span>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
          No subscription found for this workspace. The free plan will be
          created automatically on next sign-in.
        </div>
      )}

      {highlightUpgrade ? (
        <p className="text-[13px] text-text-muted">
          You came here from the upgrade prompt. Paid plans land in the next
          release — pick a tile below to preview what you'd be on.
        </p>
      ) : null}
    </header>
  );
}
