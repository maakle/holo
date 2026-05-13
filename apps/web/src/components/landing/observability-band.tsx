import { Activity, Bot, MousePointer2, Rewind, SearchX, Siren, Sparkles, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ObsItem = {
  Icon: LucideIcon;
  title: string;
  body: string;
};

const OBS_ITEMS: ObsItem[] = [
  {
    Icon: Activity,
    title: 'Tool traffic',
    body: 'Which procedures get called, by which agent, p50/p95 latency, error rates.',
  },
  {
    Icon: SearchX,
    title: 'Failed queries',
    body: 'What agents tried to ask but got nothing. Every gap is a candidate for the next procedure.',
  },
  {
    Icon: Rewind,
    title: 'Audit & replay',
    body: 'Per-call attribution: which agent, which user, which records. Replay any past invocation side-by-side.',
  },
  {
    Icon: Siren,
    title: 'Anomaly signals',
    body: 'Spikes, exfiltration shapes, prompt-injection-shaped tool calls — surfaced before they become incidents.',
  },
];

type StreamRow = {
  t: string;
  agent: string;
  Icon: LucideIcon;
  tool: string;
  scope: string;
  ms: string;
  status: 'ok' | 'warn' | 'err';
};

const STREAM: StreamRow[] = [
  { t: '14:02:11', agent: 'Claude', Icon: Sparkles, tool: 'search', scope: 'sales', ms: '64ms', status: 'ok' },
  { t: '14:02:09', agent: 'Cursor', Icon: MousePointer2, tool: 'get_repo', scope: 'eng', ms: '82ms', status: 'ok' },
  { t: '14:02:08', agent: 'ChatGPT', Icon: Bot, tool: 'search', scope: 'support', ms: '71ms', status: 'ok' },
  { t: '14:02:06', agent: 'n8n', Icon: Workflow, tool: 'draft_reply', scope: 'support', ms: '210ms', status: 'warn' },
  { t: '14:02:03', agent: 'Claude', Icon: Sparkles, tool: 'answer_security_q', scope: 'sec', ms: '143ms', status: 'ok' },
  { t: '14:02:01', agent: 'Cursor', Icon: MousePointer2, tool: 'get_ticket', scope: 'support', ms: '—', status: 'err' },
  { t: '14:01:58', agent: 'ChatGPT', Icon: Bot, tool: 'search', scope: 'sales', ms: '67ms', status: 'ok' },
];

const STATUS_DOT = {
  ok: 'bg-success',
  warn: 'bg-warning',
  err: 'bg-error',
} as const;

const STATUS_TEXT = {
  ok: 'text-text-muted',
  warn: 'text-warning',
  err: 'text-error',
} as const;

const FILTERS = [
  { l: 'all', active: true, c: '1,284', bad: false },
  { l: 'agents', active: false, c: '7', bad: false },
  { l: 'tools', active: false, c: '12', bad: false },
  { l: 'errors', active: false, c: '3', bad: true },
  { l: 'anomalies', active: false, c: '0', bad: false },
];

export function ObservabilityBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="grid items-start gap-14 lg:grid-cols-[1fr_1.2fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="caption text-text-subtle">Observability</p>
            <h2
              className="mt-3.5 font-display font-semibold text-text"
              style={{
                fontSize: 'clamp(34px, 4vw, 52px)',
                lineHeight: 1.05,
                letterSpacing: '-0.015em',
                textWrap: 'balance',
              }}
            >
              See what every agent did.
            </h2>
            <p className="mt-5 max-w-[440px] text-[15px] leading-[1.6] text-text-muted">
              You handed agents the keys to your CRM and Slack. The dashboard shows what they
              did with them.
            </p>

            <div className="mt-7 flex items-baseline gap-5">
              <span
                className="font-display font-semibold text-text"
                style={{
                  fontSize: 'clamp(56px, 7vw, 88px)',
                  lineHeight: 0.95,
                  letterSpacing: '-0.04em',
                }}
              >
                100<span className="text-accent">%</span>
              </span>
              <div>
                <p className="text-[14px] text-text">of calls logged &amp; attributable</p>
                <p className="mt-1 text-[12px] text-text-subtle">
                  per agent · per user · per record
                </p>
              </div>
            </div>

            <div className="mt-9 grid grid-cols-2 gap-4">
              {OBS_ITEMS.map((it) => (
                <div key={it.title} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-text-muted">
                    <it.Icon className="h-3.5 w-3.5" aria-hidden />
                    <p className="font-display text-[15px] font-semibold text-text">
                      {it.title}
                    </p>
                  </div>
                  <p className="text-[13px] leading-[19px] text-text-muted">{it.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Live event stream mockup */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-3 border-b border-border px-4.5 py-3.5">
              <Activity className="h-3.5 w-3.5 text-text-subtle" aria-hidden />
              <span className="font-display text-[14px] font-semibold text-text">
                Event stream
              </span>
              <span className="ml-2 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                live
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> 7 agents
                online
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4.5 py-2.5">
              {FILTERS.map((f) => {
                const baseChip =
                  'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px]';
                return (
                  <button
                    key={f.l}
                    type="button"
                    className={baseChip}
                    style={
                      f.active
                        ? {
                            background:
                              'color-mix(in srgb, var(--accent) 12%, transparent)',
                            border:
                              '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                            color: 'var(--accent)',
                            fontFamily: 'var(--font-sans)',
                            textTransform: 'lowercase',
                          }
                        : {
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-sans)',
                            textTransform: 'lowercase',
                          }
                    }
                  >
                    {f.l}
                    <span
                      className="font-mono"
                      style={{ color: f.bad ? 'var(--error)' : 'inherit' }}
                    >
                      {f.c}
                    </span>
                  </button>
                );
              })}
              <span className="ml-auto font-mono text-[11px] text-text-subtle">last 24h</span>
            </div>

            {STREAM.map((e, i) => (
              <div
                key={i}
                className={`grid items-center gap-2.5 px-4.5 py-2.5 text-[12.5px] ${
                  i < STREAM.length - 1 ? 'border-b border-border' : ''
                }`}
                style={{ gridTemplateColumns: '70px 14px 1fr 1fr auto 50px' }}
              >
                <span className="font-mono text-[11px] text-text-subtle">{e.t}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status]}`}
                  aria-hidden
                />
                <span className="inline-flex items-center gap-1.5 text-text">
                  <e.Icon className="h-2.5 w-2.5" aria-hidden />
                  <span className="font-medium">{e.agent}</span>
                </span>
                <span className="font-mono text-[11.5px] text-text-muted">{e.tool}</span>
                <span className="rounded-sm border border-border bg-surface-2 px-1 py-px font-mono text-[9px] text-text-subtle">
                  {e.scope}
                </span>
                <span
                  className={`text-right font-mono text-[11px] ${STATUS_TEXT[e.status]}`}
                >
                  {e.ms}
                </span>
              </div>
            ))}

            <div className="flex items-center gap-3.5 bg-surface-2 px-4.5 py-3.5">
              <span className="text-[11px] text-text-subtle">last hour</span>
              <svg viewBox="0 0 200 28" width="200" height="28" className="max-w-[280px] flex-1" aria-hidden>
                <polyline
                  points="0,18 12,16 24,12 36,18 48,8 60,14 72,6 84,12 96,4 108,10 120,2 132,9 144,5 156,12 168,7 180,14 192,9 200,11"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
              </svg>
              <span className="ml-auto font-mono text-[11px] text-text-muted">1,284 / hr</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
