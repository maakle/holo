'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check } from 'lucide-react';

type HostedPlan = {
  slug: 'free' | 'starter' | 'team' | 'scale' | 'business';
  name: string;
  /** Headline price for monthly billing. Always shown when toggle is monthly. */
  monthlyPrice: string;
  /** Per-month price when billed annually (~15% off list). NULL for plans
   *  that don't offer annual billing (Free). When the user selects Annual,
   *  this is the headline; the cadence string adds "billed annually". */
  annualPerMonthPrice?: string;
  /** Total yearly amount displayed as a sub-caption on annual. */
  annualTotal?: string;
  cadence?: string;
  credits: string;
  connectors: string;
  chunks: string;
  blurb: string;
  popular?: boolean;
};

const HOSTED_PLANS: HostedPlan[] = [
  {
    slug: 'free',
    name: 'Free',
    monthlyPrice: '$0',
    cadence: '14-day trial',
    credits: '250',
    connectors: '2 connectors',
    chunks: '25K chunks',
    blurb: 'Kick the tires on the hosted version. No credit card.',
  },
  {
    slug: 'starter',
    name: 'Starter',
    monthlyPrice: '$99',
    annualPerMonthPrice: '$84',
    annualTotal: '$1,008 / year',
    cadence: '/mo',
    credits: '2,500',
    connectors: '5 connectors',
    chunks: '100K chunks',
    blurb: 'For solo builders and small teams running a handful of agents.',
  },
  {
    slug: 'team',
    name: 'Team',
    monthlyPrice: '$499',
    annualPerMonthPrice: '$424',
    annualTotal: '$5,088 / year',
    cadence: '/mo',
    credits: '20,000',
    connectors: 'Unlimited connectors',
    chunks: '500K chunks',
    blurb: 'For engineering teams in production. Standard sync intervals.',
    popular: true,
  },
  {
    slug: 'scale',
    name: 'Scale',
    monthlyPrice: '$999',
    annualPerMonthPrice: '$849',
    annualTotal: '$10,188 / year',
    cadence: '/mo',
    credits: '50,000',
    connectors: 'Unlimited connectors',
    chunks: '2M chunks',
    blurb: 'For teams that have outgrown Team but aren’t at Business volume yet.',
  },
  {
    slug: 'business',
    name: 'Business',
    monthlyPrice: '$1,999',
    annualPerMonthPrice: '$1,699',
    annualTotal: '$20,388 / year',
    cadence: '/mo',
    credits: '100,000',
    connectors: 'Unlimited connectors',
    chunks: '10M chunks',
    blurb: 'High-volume workloads. Priority sync intervals. Same binary.',
  },
];

export function PricingHostedPlans() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('annual');

  return (
    <>
      <div className="mb-6 flex items-center justify-end gap-2">
        <div
          role="tablist"
          aria-label="Billing interval"
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={interval === 'monthly'}
            onClick={() => setInterval('monthly')}
            className={[
              'h-8 rounded-[5px] px-3 text-[12.5px] font-medium transition-colors',
              interval === 'monthly'
                ? 'bg-surface-2 text-text'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={interval === 'annual'}
            onClick={() => setInterval('annual')}
            className={[
              'h-8 rounded-[5px] px-3 text-[12.5px] font-medium transition-colors',
              interval === 'annual'
                ? 'bg-surface-2 text-text'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Annual{' '}
            <span className="ml-1 text-[11px] tracking-[0.04em] text-accent">−15%</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {HOSTED_PLANS.map((plan) => {
          const onAnnual = interval === 'annual' && plan.annualPerMonthPrice;
          const headlinePrice = onAnnual ? plan.annualPerMonthPrice! : plan.monthlyPrice;
          const cadence = onAnnual ? '/mo billed annually' : plan.cadence;
          const href =
            plan.slug === 'free'
              ? '/sign-in'
              : `/sign-in?plan=${plan.slug}&interval=${interval}`;

          return (
            <div
              key={plan.slug}
              className={[
                'flex flex-col rounded-md border bg-surface p-5',
                plan.popular ? 'border-accent' : 'border-border',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between">
                <h4 className="font-display text-[18px] font-semibold text-text">
                  {plan.name}
                </h4>
                {plan.popular ? (
                  <span className="inline-flex items-center rounded-sm bg-accent/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-accent">
                    Most popular
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-mono text-[28px] leading-none tabular-nums text-text">
                  {headlinePrice}
                </span>
                {cadence ? (
                  <span className="text-[13px] text-text-muted">{cadence}</span>
                ) : null}
              </div>
              {onAnnual && plan.annualTotal ? (
                <p className="mt-1 text-[11.5px] text-text-subtle tabular-nums">
                  {plan.annualTotal}
                </p>
              ) : null}
              <p className="mt-4 text-[13px] leading-[1.55] text-text-muted">
                {plan.blurb}
              </p>
              <ul className="mt-5 mb-6 space-y-2 text-[13px] text-text-muted">
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>
                    <span className="tabular-nums text-text">{plan.credits}</span> credits
                    / month
                  </span>
                </li>
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>{plan.connectors}</span>
                </li>
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  <span>{plan.chunks}</span>
                </li>
              </ul>
              <Link
                href={href}
                className={[
                  'mt-auto inline-flex h-10 w-full items-center justify-center rounded-md px-3 text-[13px] font-medium transition-opacity',
                  plan.popular
                    ? 'bg-accent text-accent-fg hover:opacity-90'
                    : 'border border-border bg-surface text-text hover:bg-surface-2',
                ].join(' ')}
              >
                {plan.slug === 'free' ? 'Start free trial' : `Choose ${plan.name}`}
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
