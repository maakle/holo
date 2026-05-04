'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { onSyncTriggered } from '@/lib/sync-events';

type Run = {
  id: string;
  queue: string;
  state: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed';
  enqueuedAt: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  attempts: number;
  artifactCount: number | null;
  failedReason: string | null;
  failedFix: string | null;
};

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
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function run(): Promise<void> {
      try {
        const res = await fetch(`/api/connectors/${provider}/runs`, { cache: 'no-store' });
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
            const expanded = openErrorId === r.id + r.queue;
            return (
              <li
                key={`${r.queue}:${r.id}`}
                className="border-b border-border last:border-b-0"
              >
                <div className="flex items-start gap-3 px-3 py-2 text-[12px]">
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
                      {r.artifactCount !== null ? (
                        <span className="text-text-muted">
                          · {r.artifactCount} artifacts
                        </span>
                      ) : null}
                      {r.attempts > 1 ? (
                        <span className="text-warning">
                          · {r.attempts} attempts
                        </span>
                      ) : null}
                    </div>
                    {r.state === 'failed' && r.failedReason ? (
                      <div className="mt-1">
                        <button
                          type="button"
                          className="text-[11px] text-error underline-offset-2 hover:underline"
                          onClick={() =>
                            setOpenErrorId(expanded ? null : r.id + r.queue)
                          }
                        >
                          {expanded ? 'Hide error' : 'Show error'}
                        </button>
                        {expanded ? (
                          <div className="mt-1 rounded-sm border border-error/30 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-2 font-mono text-[11px] text-error">
                            <div>{r.failedReason}</div>
                            {r.failedFix ? (
                              <div className="mt-1 text-error/80">Fix: {r.failedFix}</div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
