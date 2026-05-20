import { Briefcase, MessageSquare, Search, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TrackInView } from '@/components/landing/track-in-view';

type UseCase = {
  Icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  trace: string;
};

const USE_CASES: UseCase[] = [
  {
    Icon: Briefcase,
    label: 'Sales enablement',
    title: 'Answer "can our product do this?" in seconds.',
    body: 'AEs and SEs paste the question into Slack or their agent. Holo answers from source code, Linear, prior calls, and the deal record — every answer cited.',
    trace: 'search → bash cat /github/… → bash cat /pylon/… → draft',
  },
  {
    Icon: MessageSquare,
    label: 'Customer support',
    title: 'Drafted replies with the right sources attached.',
    body: 'A new ticket fires a webhook. Holo pulls the customer’s history, matching docs, and prior resolutions — and posts a draft reply for the human to approve.',
    trace: 'search → bash cat /pylon/… → bash grep -r /notion → draft',
  },
  {
    Icon: ShieldCheck,
    label: 'Security & compliance',
    title: 'Security questionnaires answered with citations.',
    body: 'Paste the questionnaire into chat. Holo pulls prior answers, architecture docs, and source code as evidence — drafts answers with links to every source.',
    trace: 'search → bash cat /notion/… → bash cat /github/…/code/… → draft',
  },
  {
    Icon: Search,
    label: 'Everyone else',
    title: 'One search box across every system.',
    body: 'A dashboard search or a Slack /ask hits REST directly. Ranked results across every connector — no agent, no MCP, no LLM in the path.',
    trace: 'POST /v1/search → ranked chunks',
  },
];

export function UseCasesBand() {
  return (
    <section className="border-b border-border">
      <TrackInView section="use-cases" />
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="mb-12 max-w-[540px]">
          <p className="caption text-text-subtle">Use cases</p>
          <h2
            className="mt-3.5 font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            Start with sales and support.
            <br />
            Extend from there.
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <div key={u.label} className="rounded-lg border border-border bg-surface p-7">
              <div className="flex items-center gap-3">
                <div className="flex h-8.5 w-8.5 items-center justify-center rounded-md border border-border text-text-muted">
                  <u.Icon className="h-4 w-4" aria-hidden />
                </div>
                <p className="caption text-text-subtle">{u.label}</p>
              </div>
              <h3 className="mt-4 font-display text-[20px] font-semibold leading-tight tracking-tight text-text">
                {u.title}
              </h3>
              <p className="mt-2.5 text-[14px] leading-[22px] text-text-muted">{u.body}</p>
              <div className="mt-4 flex items-center gap-2.5 border-t border-dashed border-border pt-3.5">
                <span className="caption text-[10px] text-text-subtle">Trace</span>
                <span className="font-mono text-[11.5px] text-text-subtle">{u.trace}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
