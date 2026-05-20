import type { PlanRow } from '@holo/billing';
import { Check } from 'lucide-react';

interface Props {
  plans: PlanRow[];
  currentSlug: string | null;
  highlightSlug?: string | null;
}

const SLUG_ORDER = ['free', 'starter', 'team', 'business'];

function formatCredits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(0)}`;
}

export function PlanGrid({ plans, currentSlug, highlightSlug }: Props) {
  const ordered = [...plans].sort(
    (a, b) => SLUG_ORDER.indexOf(a.slug) - SLUG_ORDER.indexOf(b.slug),
  );

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Plans</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ordered.map((plan) => {
          const isCurrent = currentSlug === plan.slug;
          const isHighlight = highlightSlug === plan.slug;
          return (
            <div
              key={plan.id}
              className={[
                'flex flex-col rounded-md border bg-surface p-5',
                isHighlight
                  ? 'border-accent shadow-[0_0_0_1px_var(--accent)]'
                  : 'border-border',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between">
                <h4 className="font-display text-[18px] font-semibold text-text">
                  {plan.name}
                </h4>
                {isCurrent ? (
                  <span className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-text-muted">
                    Current
                  </span>
                ) : null}
              </div>
              <div className="mt-3 font-mono text-[28px] leading-none tabular-nums text-text">
                {formatPrice(plan.monthlyPriceCents)}
                {plan.monthlyPriceCents > 0 ? (
                  <span className="ml-1 text-[13px] font-normal text-text-muted">
                    /mo
                  </span>
                ) : null}
              </div>
              <ul className="mt-5 space-y-2 text-[13px] text-text-muted">
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>
                    <span className="tabular-nums text-text">
                      {formatCredits(plan.monthlyCredits)}
                    </span>{' '}
                    credits / month
                  </span>
                </li>
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>
                    {plan.features.maxConnectors === null
                      ? 'Unlimited connectors'
                      : `${plan.features.maxConnectors} connector${plan.features.maxConnectors === 1 ? '' : 's'}`}
                  </span>
                </li>
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>Star Wars sample dataset included</span>
                </li>
              </ul>
              <button
                type="button"
                disabled
                title="Paid plans land in the next release"
                className="mt-6 w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-muted opacity-60"
              >
                {isCurrent ? 'Current plan' : 'Coming soon'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
