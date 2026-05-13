import { ArrowRight, GitPullRequest, Plus } from 'lucide-react';
import { ConnectorLogo } from '@/components/connector-logo';
import type { ConnectorMeta } from '@/lib/connector-registry';

const CONNECTORS: { id: ConnectorMeta['id']; name: string }[] = [
  { id: 'slack', name: 'Slack' },
  { id: 'github', name: 'GitHub' },
  { id: 'notion', name: 'Notion' },
  { id: 'linear', name: 'Linear' },
  { id: 'jira', name: 'Jira' },
  { id: 'confluence', name: 'Confluence' },
  { id: 'grain', name: 'Grain' },
  { id: 'hubspot', name: 'HubSpot' },
  { id: 'salesforce', name: 'Salesforce' },
  { id: 'stripe', name: 'Stripe' },
  { id: 'zendesk', name: 'Zendesk' },
  { id: 'pylon', name: 'Pylon' },
  { id: 'googledrive', name: 'Google Drive' },
  { id: 'google-chat', name: 'Google Chat' },
  { id: 'airtable', name: 'Airtable' },
  { id: 'asana', name: 'Asana' },
  { id: 'gitlab', name: 'GitLab' },
  { id: 'mintlify', name: 'Mintlify' },
  { id: 'prismic', name: 'Prismic' },
  { id: 'webcrawl', name: 'Web crawl' },
];

export function ConnectorsBand() {
  return (
    <section id="connectors" className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="grid items-start gap-16 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="caption text-text-subtle">Connectors</p>
            <h2
              className="mt-3.5 font-display font-semibold text-text"
              style={{
                fontSize: 'clamp(34px, 4vw, 52px)',
                lineHeight: 1.05,
                letterSpacing: '-0.015em',
                textWrap: 'balance',
              }}
            >
              Holo connects to all your tools.
            </h2>
            <p className="mt-5 max-w-[380px] text-[15px] leading-[1.55] text-text-muted">
              Plug-and-play, syncs continuously, respects ACLs at ingestion. Every connector
              is open source and extensible.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="https://github.com/maakle/holo#connectors"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-4 text-[13px] font-medium text-text transition-colors hover:border-border-strong"
              >
                See all 20 connectors
                <ArrowRight className="h-3 w-3" aria-hidden />
              </a>
              <a
                href="https://github.com/maakle/holo/tree/main/packages/connector-framework"
                className="inline-flex h-9 items-center rounded-md px-3 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
              >
                Build your own
              </a>
            </div>
            <div className="mt-7 max-w-[380px] rounded-md border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-[12px] text-text-subtle">
                <GitPullRequest className="h-3 w-3" aria-hidden />
                <span className="font-mono">packages/connector-framework</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-text-muted">
                90-line TypeScript interface. Ship a new connector in an afternoon.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6 md:grid-cols-7">
            {CONNECTORS.map((c) => (
              <div
                key={c.id}
                title={c.name}
                className="flex aspect-square items-center justify-center rounded-md border border-border bg-surface transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <ConnectorLogo id={c.id} className="h-8 w-8 object-contain" />
              </div>
            ))}
            <div className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border bg-surface text-text-muted">
              <Plus className="h-4 w-4" aria-hidden />
              <span className="font-mono text-[9px] text-text-subtle">BYO</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
