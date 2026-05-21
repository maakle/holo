'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { resolveStorageCap } from '@holo/billing/plan-defaults';
import type { PlanRow } from '@holo/billing';

interface Props {
  plans: PlanRow[];
  currentSlug: string | null;
  highlightSlug?: string | null;
}

const SLUG_ORDER = ['free', 'starter', 'team', 'business'];
const PURCHASABLE = new Set(['starter', 'team', 'business']);
const POPULAR_SLUG = 'team';

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
  const currentIndex = currentSlug ? SLUG_ORDER.indexOf(currentSlug) : -1;
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function startCheckout(planSlug: string) {
    setBusy(planSlug);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        fix?: string;
        problem?: string;
      };
      if (!res.ok || !body.url) {
        toast.error(body.fix ?? body.problem ?? 'Could not start checkout.');
        return;
      }
      // Hand control to Stripe Checkout.
      startTransition(() => {
        window.location.href = body.url!;
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="plans" className="space-y-3 scroll-mt-8">
      <h3 className="text-[15px] font-medium text-text">Plans</h3>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {ordered.map((plan) => {
          const isCurrent = currentSlug === plan.slug;
          const isHighlight = highlightSlug === plan.slug;
          const purchasable = PURCHASABLE.has(plan.slug);

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
                ) : plan.slug === POPULAR_SLUG ? (
                  <span className="inline-flex items-center rounded-sm bg-accent/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-accent">
                    Most popular
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
              <ul className="mt-5 mb-6 space-y-2 text-[13px] text-text-muted">
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
                  <span>
                    {(() => {
                      // Fall back to the slug-keyed default if the DB row is
                      // missing `maxStoredArtifacts` (legacy seed rows from
                      // pre-0067 migrations). Same source of truth the gate
                      // uses, so what we advertise matches what we enforce.
                      const cap = resolveStorageCap(
                        plan.slug,
                        plan.features.maxStoredArtifacts,
                      );
                      return cap === null ? (
                        'Unlimited indexed items'
                      ) : (
                        <>
                          Up to{' '}
                          <span className="tabular-nums text-text">
                            {formatCredits(cap)}
                          </span>{' '}
                          indexed items
                        </>
                      );
                    })()}
                  </span>
                </li>
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>Star Wars sample dataset included</span>
                </li>
              </ul>
              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="mt-auto w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-muted opacity-60"
                >
                  Current plan
                </button>
              ) : purchasable ? (
                <button
                  type="button"
                  onClick={() => startCheckout(plan.slug)}
                  disabled={busy !== null}
                  className={[
                    'mt-auto w-full rounded-md px-3 py-2 text-[13px] font-medium transition-opacity',
                    isHighlight
                      ? 'bg-accent text-accent-fg hover:opacity-90'
                      : 'border border-border bg-surface text-text hover:bg-surface-2',
                    busy === plan.slug ? 'opacity-70' : '',
                  ].join(' ')}
                >
                  {busy === plan.slug
                    ? 'Opening Stripe…'
                    : currentIndex >= 0 && SLUG_ORDER.indexOf(plan.slug) < currentIndex
                      ? `Downgrade to ${plan.name}`
                      : `Upgrade to ${plan.name}`}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Contact us for Enterprise."
                  className="mt-auto w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-muted opacity-60"
                >
                  {plan.slug === 'free' ? 'Free tier' : 'Contact sales'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
