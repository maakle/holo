import { ArrowRight, Check, Scale } from 'lucide-react';
import { GithubMark } from '@/components/landing/brand-marks';
import { TrackInView } from '@/components/landing/track-in-view';
import { PricingHostedPlans } from '@/components/landing/pricing-hosted-plans';

const GITHUB_URL = 'https://github.com/maakle/holo';
const LICENSING_URL = `${GITHUB_URL}/blob/main/LICENSING.md`;

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

          <PricingHostedPlans />

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
