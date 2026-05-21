interface Props {
  llmCredits: number;
  syncCredits: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Two-meter usage display (RFC 0010 / ADR 0007 — W2). Shows agent runs and
 * connector sync as separate progress bars over the same shared pool, so the
 * "I connected Slack and burned my whole month's budget" panic is impossible:
 * users see exactly which category is consuming credits.
 *
 * Bars are scaled to the same denominator (total spent this period) so their
 * widths visually represent the *share* of consumption, not absolute pool
 * usage. The combined total is shown beneath so the absolute number stays
 * one click away.
 */
export function UsageBreakdown({ llmCredits, syncCredits }: Props) {
  const total = llmCredits + syncCredits;
  const llmRatio = total > 0 ? llmCredits / total : 0;
  const syncRatio = total > 0 ? syncCredits / total : 0;

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Usage this period</h3>
      <div className="rounded-md border border-border bg-surface p-5 space-y-5">
        <UsageMeter
          label="Agent runs"
          sublabel="Chat turns, deep research, agent tool calls"
          credits={llmCredits}
          ratio={llmRatio}
          accent="bg-accent"
        />
        <UsageMeter
          label="Connector sync"
          sublabel="Embedding + storage as connectors ingest content"
          credits={syncCredits}
          ratio={syncRatio}
          accent="bg-text-subtle"
        />
        <div className="flex justify-between border-t border-border pt-3 text-[12px] tabular-nums text-text-muted">
          <span>Total this period</span>
          <span className="text-text">{fmt(total)} credits</span>
        </div>
      </div>
    </section>
  );
}

function UsageMeter(props: {
  label: string;
  sublabel: string;
  credits: number;
  ratio: number;
  accent: string;
}) {
  const pct = (props.ratio * 100).toFixed(1);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-text">{props.label}</span>
        <span className="text-[13px] tabular-nums text-text">
          {fmt(props.credits)}
          <span className="ml-1 text-text-muted">credits</span>
        </span>
      </div>
      <p className="mt-1 text-[12px] text-text-muted">{props.sublabel}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
        <div
          className={`h-full ${props.accent}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
