interface Props {
  llmCredits: number;
  syncCredits: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function UsageBreakdown({ llmCredits, syncCredits }: Props) {
  const total = llmCredits + syncCredits;

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Usage this period</h3>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Category
              </th>
              <th className="px-4 py-3 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Credits
              </th>
              <th className="px-4 py-3 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-[14px] text-[13px] text-text">
                Chat / agent runs
              </td>
              <td className="px-4 py-[14px] text-right text-[13px] tabular-nums text-text">
                {fmt(llmCredits)}
              </td>
              <td className="px-4 py-[14px] text-right text-[13px] tabular-nums text-text-muted">
                {total > 0 ? `${((llmCredits / total) * 100).toFixed(0)}%` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-[14px] text-[13px] text-text">
                Connector sync
              </td>
              <td className="px-4 py-[14px] text-right text-[13px] tabular-nums text-text">
                {fmt(syncCredits)}
              </td>
              <td className="px-4 py-[14px] text-right text-[13px] tabular-nums text-text-muted">
                {total > 0 ? `${((syncCredits / total) * 100).toFixed(0)}%` : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
