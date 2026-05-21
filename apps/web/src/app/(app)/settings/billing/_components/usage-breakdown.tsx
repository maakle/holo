interface Props {
  llmCredits: number;
  syncCredits: number;
  monthlyGrant: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Two-meter usage display (RFC 0010 / ADR 0007 — W2). Shows agent runs and
 * connector sync as separate progress bars over the monthly pool, so users
 * see exactly which category is consuming credits and how much of the budget
 * each has burned.
 *
 * Bars scale to the monthly grant so a small absolute number reads as a
 * small bar — preventing the false "you're maxed out" signal that share-of-mix
 * scaling produced when only one category had any activity.
 */
export function UsageBreakdown({ llmCredits, syncCredits, monthlyGrant }: Props) {
  const total = llmCredits + syncCredits;
  const llmRatio = monthlyGrant > 0 ? Math.min(llmCredits / monthlyGrant, 1) : 0;
  const syncRatio = monthlyGrant > 0 ? Math.min(syncCredits / monthlyGrant, 1) : 0;
  const totalRatio = Math.min(llmRatio + syncRatio, 1);
  const llmShare = totalRatio > 0 ? (llmRatio / (llmRatio + syncRatio)) * totalRatio : 0;
  const syncShare = totalRatio > 0 ? (syncRatio / (llmRatio + syncRatio)) * totalRatio : 0;
  const totalPct = (totalRatio * 100).toFixed(1);

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
        <div className="border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-text">Total this period</span>
            <span className="text-[13px] tabular-nums text-text">
              {fmt(total)}
              <span className="ml-1 text-text-muted">
                / {fmt(monthlyGrant)} credits ({totalPct}%)
              </span>
            </span>
          </div>
          <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
            <div className="h-full bg-accent" style={{ width: `${llmShare * 100}%` }} />
            <div className="h-full bg-text-subtle" style={{ width: `${syncShare * 100}%` }} />
          </div>
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
