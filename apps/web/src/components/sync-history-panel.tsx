'use client';
import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, ChevronRight, Clock, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { onSyncTriggered } from '@/lib/sync-events';

type Run = {
  id: string;
  queue: string;
  state: 'completed' | 'failed' | 'cancelled' | 'stalled' | 'active' | 'waiting' | 'delayed';
  enqueuedAt: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  attempts: number;
  artifactCount: number | null;
  failedReason: string | null;
  failedFix: string | null;
  skipReason: string | null;
  liveArtifactCount: number | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  progressMessage: string | null;
  breakdown: Record<string, { new: number; deduped: number }> | null;
};

function totalsFromBreakdown(
  breakdown: Run['breakdown'],
): { newCount: number; dedupedCount: number } | null {
  if (!breakdown) return null;
  let newCount = 0;
  let dedupedCount = 0;
  for (const slot of Object.values(breakdown)) {
    newCount += slot.new;
    dedupedCount += slot.deduped;
  }
  return { newCount, dedupedCount };
}

function describeSkipReason(reason: string): string {
  if (reason === 'no_channels_selected') return 'no channels selected';
  return reason;
}

interface Props {
  provider: string;
}

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatArtifacts(
  state: Run['state'],
  count: number | null,
  skipReason: string | null,
): string | null {
  if (skipReason) return describeSkipReason(skipReason);
  if (count === null) return null;
  if (count === 0) {
    return state === 'completed' ? 'up to date' : '0 new chunks';
  }
  return `+${count.toLocaleString()} new chunks`;
}

function StateBadge({ state }: { state: Run['state'] }) {
  if (state === 'completed') {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> ok
      </Badge>
    );
  }
  if (state === 'failed') {
    return (
      <Badge variant="error" className="gap-1">
        <XCircle className="h-3 w-3" aria-hidden /> failed
      </Badge>
    );
  }
  if (state === 'active') {
    return (
      <Badge variant="accent" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> active
      </Badge>
    );
  }
  if (state === 'cancelled') {
    return (
      <Badge variant="neutral" className="gap-1">
        <Ban className="h-3 w-3" aria-hidden /> cancelled
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className="gap-1">
      <Clock className="h-3 w-3" aria-hidden /> {state}
    </Badge>
  );
}

export function SyncHistoryPanel({ provider }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function run(): Promise<void> {
      try {
        let res: Response;
        try {
          res = await fetch(`/api/connectors/${provider}/runs`, { cache: 'no-store' });
        } catch (err) {
          // Network blip (dev server restart, offline, etc.) — keep the
          // existing data on screen and try again on the next poll tick.
          if (!cancelled) setError((err as Error).message);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          runs?: Run[];
          problem?: string;
          fix?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        const list = body.runs ?? [];
        setRuns(list);
        setError(null);
        // Keep polling while anything is in flight so worker-side completions
        // surface without the user clicking Refresh. Stop once everything
        // settles to avoid background traffic.
        const inFlight = list.some((r) => r.state === 'active' || r.state === 'waiting');
        if (inFlight && !cancelled) {
          timeout = setTimeout(() => {
            if (!cancelled) void run();
          }, 4000);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    const off = onSyncTriggered(provider, () => {
      void run();
    });
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      off();
    };
  }, [provider]);

  if (loading && !runs) {
    return <div className="text-[12px] text-text-muted">Loading history…</div>;
  }
  if (error && !runs) {
    return <div className="text-[12px] text-error">{error}</div>;
  }
  if (!runs) return null;

  return (
    <div className="rounded-md border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[12px] text-text-muted">{runs.length} runs</div>
        <button
          type="button"
          onClick={async () => {
            setLoading(true);
            const res = await fetch(`/api/connectors/${provider}/runs`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { runs?: Run[] };
            setRuns(body.runs ?? []);
            setLoading(false);
          }}
          className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-text-muted">
          No runs yet. Trigger one with Sync now or wait for the recurring schedule.
        </div>
      ) : (
        <ul>
          {runs.map((r) => {
            const rowKey = `${r.queue}:${r.id}`;
            const expanded = openRowId === rowKey;
            const breakdownTotals = totalsFromBreakdown(r.breakdown);
            // When a breakdown exists, prefer the richer "+N new · M deduped"
            // label over the legacy single-int "new chunks" line — both
            // pull from the same data, but the breakdown also tells the user
            // how much was already-indexed work the connector re-emitted.
            const artifactsLabel =
              breakdownTotals && r.state === 'completed'
                ? breakdownTotals.newCount === 0 && breakdownTotals.dedupedCount === 0
                  ? 'up to date'
                  : `+${breakdownTotals.newCount.toLocaleString()} new${
                      breakdownTotals.dedupedCount > 0
                        ? ` · ${breakdownTotals.dedupedCount.toLocaleString()} deduped`
                        : ''
                    }`
                : formatArtifacts(r.state, r.artifactCount, r.skipReason);
            // While running, surface the heartbeat in the collapsed header so
            // users see motion without expanding. Falls back to live chunk
            // counter when the connector hasn't reported a message yet.
            const liveLabel =
              r.state === 'active'
                ? r.progressMessage ??
                  (r.progressCurrent !== null && r.progressTotal !== null
                    ? `${r.progressCurrent} / ${r.progressTotal}`
                    : r.liveArtifactCount && r.liveArtifactCount > 0
                      ? `+${r.liveArtifactCount.toLocaleString()} chunks so far`
                      : null)
                : null;
            return (
              <li
                key={rowKey}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setOpenRowId(expanded ? null : rowKey)}
                  className="flex w-full items-start gap-3 px-3 py-2 text-left text-[12px] hover:bg-surface-2"
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    className={`mt-0.5 h-3 w-3 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                  <div className="shrink-0">
                    <StateBadge state={r.state} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-text">{r.queue}</span>
                      <span className="text-text-muted">
                        {formatTime(r.finishedOn ?? r.processedOn ?? r.enqueuedAt)}
                      </span>
                      <span className="text-text-muted">
                        · {formatDuration(r.durationMs)}
                      </span>
                      {artifactsLabel ? (
                        <span className="text-text-muted">· {artifactsLabel}</span>
                      ) : null}
                      {liveLabel ? (
                        <span className="text-accent">· {liveLabel}</span>
                      ) : null}
                      {r.attempts > 1 ? (
                        <span className="text-warning">
                          · {r.attempts} attempts
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
                {expanded ? (
                  <div className="border-t border-border bg-surface-2 px-3 py-2.5 text-[12px]">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                      <dt className="text-text-muted">Queue</dt>
                      <dd className="font-mono text-text">{r.queue}</dd>
                      <dt className="text-text-muted">Job ID</dt>
                      <dd className="font-mono text-text break-all">{r.id}</dd>
                      <dt className="text-text-muted">Status</dt>
                      <dd className="text-text">{r.state}</dd>
                      <dt className="text-text-muted">Enqueued</dt>
                      <dd className="text-text">{formatTime(r.enqueuedAt)}</dd>
                      <dt className="text-text-muted">Started</dt>
                      <dd className="text-text">{formatTime(r.processedOn)}</dd>
                      <dt className="text-text-muted">Finished</dt>
                      <dd className="text-text">{formatTime(r.finishedOn)}</dd>
                      <dt className="text-text-muted">Duration</dt>
                      <dd className="text-text">{formatDuration(r.durationMs)}</dd>
                      <dt className="text-text-muted">New chunks</dt>
                      <dd className="text-text">
                        {r.skipReason
                          ? `0 (${describeSkipReason(r.skipReason)} — sync skipped)`
                          : r.artifactCount !== null
                            ? r.artifactCount === 0
                              ? '0 (content already indexed — nothing new to embed)'
                              : r.artifactCount.toLocaleString()
                            : r.state === 'active' && r.liveArtifactCount !== null
                              ? `${r.liveArtifactCount.toLocaleString()} so far (live)`
                              : '—'}
                      </dd>
                      {breakdownTotals && breakdownTotals.dedupedCount > 0 ? (
                        <>
                          <dt className="text-text-muted">Deduped</dt>
                          <dd className="text-text">
                            {breakdownTotals.dedupedCount.toLocaleString()}
                            <span className="ml-1 text-[11px] text-text-muted">
                              (content already indexed for this org)
                            </span>
                          </dd>
                        </>
                      ) : null}
                      {r.state === 'active' &&
                      (r.progressMessage || r.progressCurrent !== null) ? (
                        <>
                          <dt className="text-text-muted">Progress</dt>
                          <dd className="text-text">
                            {r.progressCurrent !== null && r.progressTotal !== null
                              ? `${r.progressCurrent} / ${r.progressTotal}`
                              : r.progressCurrent !== null
                                ? `${r.progressCurrent}`
                                : null}
                            {r.progressMessage ? (
                              <span className="block text-text-muted">
                                {r.progressMessage}
                              </span>
                            ) : null}
                          </dd>
                        </>
                      ) : null}
                      {r.attempts > 0 ? (
                        <>
                          <dt className="text-text-muted">Attempts</dt>
                          <dd className="text-text">{r.attempts}</dd>
                        </>
                      ) : null}
                    </dl>
                    {r.breakdown && Object.keys(r.breakdown).length > 0 ? (
                      <div className="mt-3">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                          Breakdown
                        </div>
                        <table className="w-full [font-variant-numeric:tabular-nums]">
                          <thead>
                            <tr className="border-b border-border text-left">
                              <th className="py-1.5 pr-3 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                                Kind
                              </th>
                              <th className="py-1.5 pr-3 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                                New
                              </th>
                              <th className="py-1.5 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                                Deduped
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(r.breakdown)
                              .sort(([, a], [, b]) => b.new + b.deduped - (a.new + a.deduped))
                              .map(([kind, slot]) => (
                                <tr key={kind} className="border-b border-border last:border-b-0">
                                  <td className="py-1.5 pr-3 font-mono text-[11px] text-text">
                                    {kind}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right text-[12px] text-text">
                                    {slot.new.toLocaleString()}
                                  </td>
                                  <td className="py-1.5 text-right text-[12px] text-text-muted">
                                    {slot.deduped.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {r.state === 'failed' && r.failedReason ? (
                      <div className="mt-2.5 rounded-sm border border-error/30 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-2 font-mono text-[11px] text-error">
                        <div>{r.failedReason}</div>
                        {r.failedFix ? (
                          <div className="mt-1 text-error/80">Fix: {r.failedFix}</div>
                        ) : null}
                        <div className="mt-2 text-[10px] text-error/70">
                          Full stack trace and underlying cause are in the worker logs.
                        </div>
                      </div>
                    ) : null}
                    {!r.breakdown && r.state === 'completed' ? (
                      <div className="mt-2.5 text-[11px] text-text-muted">
                        No per-kind breakdown for this run — runs from before
                        the breakdown column was added (migration 0028) only
                        recorded the totals above.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
