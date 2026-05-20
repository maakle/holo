import type { LedgerActivityRow } from '@holo/billing';

interface Props {
  rows: LedgerActivityRow[];
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'monthly_grant':
      return 'Monthly grant';
    case 'llm_call':
      return 'Chat / agent run';
    case 'connector_sync':
      return 'Connector sync';
    case 'topup_purchase':
      return 'Top-up';
    case 'plan_change':
      return 'Plan change';
    case 'expiry':
      return 'Top-up expiry';
    case 'manual':
      return 'Adjustment';
    default:
      return reason;
  }
}

function referenceLabel(row: LedgerActivityRow): string {
  if (!row.referenceKind || !row.referenceId) return '—';
  if (row.referenceKind === 'sync_run') {
    const provider =
      row.metadata && typeof row.metadata['provider'] === 'string'
        ? (row.metadata['provider'] as string)
        : null;
    return provider ?? 'sync';
  }
  if (row.referenceKind === 'agent_loop') {
    const surface =
      row.metadata && typeof row.metadata['surface'] === 'string'
        ? (row.metadata['surface'] as string)
        : null;
    return surface ?? 'chat';
  }
  return row.referenceKind;
}

export function LedgerTable({ rows }: Props) {
  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Activity</h3>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                When
              </th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Type
              </th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Source
              </th>
              <th className="px-4 py-3 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Credits
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-[13px] text-text-muted"
                >
                  No activity yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-[14px] text-[13px] tabular-nums text-text-muted">
                    {formatRelative(row.createdAt)}
                  </td>
                  <td className="px-4 py-[14px] text-[13px] text-text">
                    {reasonLabel(row.reason)}
                  </td>
                  <td className="px-4 py-[14px] text-[13px] text-text-muted">
                    {referenceLabel(row)}
                  </td>
                  <td
                    className={[
                      'px-4 py-[14px] text-right text-[13px] tabular-nums',
                      row.credits >= 0 ? 'text-success' : 'text-text',
                    ].join(' ')}
                  >
                    {row.credits >= 0 ? '+' : ''}
                    {row.credits.toLocaleString('en-US')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
