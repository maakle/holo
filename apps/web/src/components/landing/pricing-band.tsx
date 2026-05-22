import Link from 'next/link';
import { ArrowRight, Check, Scale } from 'lucide-react';
import { GithubMark } from '@/components/landing/brand-marks';
import { TrackInView } from '@/components/landing/track-in-view';

const GITHUB_URL = 'https://github.com/maakle/holo';
const LICENSING_URL = `${GITHUB_URL}/blob/main/LICENSING.md`;

type HostedPlan = {
  slug: 'free' | 'starter' | 'team' | 'scale' | 'business';
  name: string;
  price: string;
  cadence?: string;
  credits: string;
  connectors: string;
  /** Cap on chunks stored in the search index (one row per embedding
   *  vector). Chunk cap and connector cap are independent levers —
   *  see packages/billing/src/limits.ts. */
  chunks: string;
  blurb: string;
  popular?: boolean;
};

const HOSTED_PLANS: HostedPlan[] = [
  {
    slug: 'free',
    name: 'Free',
    price: '$0',
    cadence: '14-day trial',
    credits: '250',
    connectors: '2 connectors',
    chunks: '25K chunks',
    blurb: 'Kick the tires on the hosted version. No credit card.',
  },
  {
    slug: 'starter',
    name: 'Starter',
    price: '$99',
    cadence: '/mo',
    credits: '2,500',
    connectors: '5 connectors',
    chunks: '100K chunks',
    blurb: 'For solo builders and small teams running a handful of agents.',
  },
  {
    slug: 'team',
    name: 'Team',
    price: '$499',
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
    price: '$999',
    cadence: '/mo',
    credits: '50,000',
    connectors: 'Unlimited connectors',
    chunks: '2M chunks',
    blurb: 'For teams that have outgrown Team but aren’t at Business volume yet.',
  },
  {
    slug: 'business',
    name: 'Business',
    price: '$1,999',
    cadence: '/mo',
    credits: '100,000',
    connectors: 'Unlimited connectors',
    chunks: '10M chunks',
    blurb: 'High-volume workloads. Priority sync intervals. Same binary.',
  },
];

const SELF_HOST_FEATURES = [
  'All 20 connectors',
  'Hybrid retrieval (pgvector + tsvector)',
  'MCP + REST + OpenAPI gateway',
  'Agent observability',
  'OAuth 2.1 + PKCE provider',
  'Multi-tenant orgs',
];

export function PricingBand() {
  return (
    <section id="pricing" className="border-b border-border bg-bg">
      <TrackInView section="pricing" />
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="max-w-[640px]">
          <p className="caption text-text-subtle">Pricing</p>
          <h2
            className="mt-3.5 font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            Free to self-host. Pay for the hosted version.
          </h2>
          <p className="mt-5 max-w-[560px] text-[15px] leading-[1.6] text-text-muted">
            The Community Edition is AGPL-3.0 and free forever on your own infrastructure.
            The hosted plans below are for teams who&rsquo;d rather not operate it themselves.
          </p>
        </div>

        {/* Self-host callout */}
        <div className="mt-12 grid gap-6 rounded-lg border border-border bg-surface p-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[44px] font-medium leading-none tabular-nums text-text">
                $0
              </span>
              <span className="caption text-text-subtle">forever · self-hosted</span>
            </div>
            <h3 className="mt-4 font-display text-[24px] font-semibold leading-tight tracking-tight text-text">
              Community Edition.
            </h3>
            <p className="mt-3 max-w-[440px] text-[14px] leading-[1.6] text-text-muted">
              Deploy holo on your own infrastructure under AGPL-3.0. Every connector, the
              MCP gateway, hybrid retrieval, and agent observability are included. There
              is no closed core.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`${GITHUB_URL}#readme`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90"
              >
                Self-host guide
                <ArrowRight className="h-3 w-3" aria-hidden />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-[13px] font-medium text-text transition-colors hover:border-border-strong"
              >
                <GithubMark className="h-3.5 w-3.5" aria-hidden />
                View source
              </a>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {SELF_HOST_FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 text-[13px] leading-5 text-text-muted"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Hosted plans */}
        <div className="mt-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="caption text-text-subtle">Hosted</p>
              <h3
                className="mt-3 font-display font-semibold text-text"
                style={{
                  fontSize: 'clamp(24px, 2.4vw, 32px)',
                  lineHeight: 1.1,
                  letterSpacing: '-0.01em',
                }}
              >
                Or let us run it for you.
              </h3>
            </div>
            <p className="max-w-[360px] text-[13.5px] leading-5 text-text-muted">
              Same binary, same features. We handle the database, sync workers, and
              upgrades. Cancel anytime.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {HOSTED_PLANS.map((plan) => (
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
                    {plan.price}
                  </span>
                  {plan.cadence ? (
                    <span className="text-[13px] text-text-muted">{plan.cadence}</span>
                  ) : null}
                </div>
                <p className="mt-4 text-[13px] leading-[1.55] text-text-muted">
                  {plan.blurb}
                </p>
                <ul className="mt-5 mb-6 space-y-2 text-[13px] text-text-muted">
                  <li className="flex gap-2">
                    <Check
                      className="h-4 w-4 shrink-0 text-text-subtle"
                      aria-hidden
                    />
                    <span>
                      <span className="tabular-nums text-text">{plan.credits}</span>{' '}
                      credits / month
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Check
                      className="h-4 w-4 shrink-0 text-text-subtle"
                      aria-hidden
                    />
                    <span>{plan.connectors}</span>
                  </li>
                  <li className="flex gap-2">
                    <Check
                      className="h-4 w-4 shrink-0 text-text-subtle"
                      aria-hidden
                    />
                    <span>{plan.chunks}</span>
                  </li>
                </ul>
                <Link
                  href="/sign-in"
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
            ))}
          </div>

          {/* Enterprise row */}
          <div className="mt-4 grid gap-4 rounded-md border border-border bg-surface p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-baseline gap-3">
                <h4 className="font-display text-[18px] font-semibold text-text">
                  Enterprise
                </h4>
                <span className="font-mono text-[13px] tabular-nums text-text-muted">
                  Custom
                </span>
              </div>
              <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.55] text-text-muted">
                For organizations that need SSO/SCIM, RBAC, per-call audit log,
                custom pre/post-processing, or whitelabeling. Same binary, gated by the
                Enterprise license. Available on hosted or self-hosted.
              </p>
            </div>
            <a
              href="mailto:sales@holobase.dev?subject=Holo%20Enterprise%20inquiry"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-[13px] font-medium text-text transition-colors hover:border-border-strong"
            >
              Contact sales
              <ArrowRight className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>

        {/* Licensing note */}
        <div className="mt-10 flex flex-col gap-4 rounded-md border border-border bg-surface-2/40 p-6 sm:flex-row sm:items-start sm:gap-5">
          <div
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-subtle"
            aria-hidden
          >
            <Scale className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="caption text-text-subtle">Licensing</p>
            <p className="mt-2 text-[13.5px] leading-[1.6] text-text-muted">
              The Community Edition is{' '}
              <span className="text-text">AGPL-3.0</span> — free to self-host, fork,
              and modify. Enterprise add-ons (SSO, RBAC, per-call audit log, custom
              code, whitelabeling) live under{' '}
              <span className="font-mono text-[12.5px] text-text">ee/</span>{' '}
              directories and require a paid commercial license for production use.
              Both editions live in the same repo; the path determines the license.
            </p>
            <a
              href={LICENSING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
            >
              Read the full licensing terms
              <ArrowRight className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
