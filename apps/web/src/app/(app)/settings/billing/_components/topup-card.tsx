'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { TopupPackageRow } from '@holo/billing';

interface Props {
  packages: TopupPackageRow[];
}

function formatCredits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export function TopupCard({ packages }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (packages.length === 0) return null;

  async function startTopupCheckout(packageSlug: string) {
    setBusy(packageSlug);
    try {
      const res = await fetch('/api/stripe/topup/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageSlug }),
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
      startTransition(() => {
        window.location.href = body.url!;
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-medium text-text">Buy more credits</h3>
        <p className="text-[12px] text-text-muted">
          Credits don&rsquo;t expire and stack with your monthly grant.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {packages.map((pkg) => {
          const perThousand = (pkg.priceCents / 100) / (pkg.credits / 1000);
          const unavailable = pkg.stripePriceId === null;
          return (
            <div
              key={pkg.id}
              className="flex flex-col rounded-md border border-border bg-surface p-5"
            >
              <h4 className="font-display text-[16px] font-semibold text-text">
                {pkg.name}
              </h4>
              <div className="mt-3 font-mono text-[28px] leading-none tabular-nums text-text">
                {formatPrice(pkg.priceCents)}
              </div>
              <p className="mt-2 text-[13px] text-text-muted">
                <span className="tabular-nums text-text">
                  {formatCredits(pkg.credits)}
                </span>{' '}
                credits
              </p>
              <p className="mt-1 text-[12px] tabular-nums text-text-subtle">
                ${perThousand.toFixed(2)} per 1K credits
              </p>
              <button
                type="button"
                onClick={() => startTopupCheckout(pkg.slug)}
                disabled={busy !== null || unavailable}
                title={unavailable ? 'Stripe price not yet provisioned — retry shortly.' : undefined}
                className={[
                  'mt-6 w-full rounded-md px-3 py-2 text-[13px] font-medium transition-opacity',
                  'border border-border bg-surface text-text hover:bg-surface-2',
                  busy === pkg.slug || unavailable ? 'opacity-70' : '',
                ].join(' ')}
              >
                {busy === pkg.slug
                  ? 'Opening Stripe…'
                  : unavailable
                    ? 'Unavailable'
                    : `Buy ${pkg.name.replace(/^Top-up:?\s*/i, '')}`}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
