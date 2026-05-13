'use client';

/**
 * Regression panel tile (RFC-0008).
 *
 * Renders:
 *   - latest pass-rate (large numeric)
 *   - sparkline of the last 14 runs
 *   - drop-warning if the most recent run dropped >10pp vs the trailing 24h avg
 *   - a "Run now" button (owner/admin-only on the server side)
 *
 * Per DESIGN.md: tabular-nums for all numbers, neutral surface, accent
 * reserved for the CTA. No gradient. No colored sparkline.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Run {
  id: string;
  passRate: number;
  total: number;
  passed: number;
  ranAt: string;
}

export function RegressionPanel({
  slug,
  runs,
  activeEntryCount,
}: {
  slug: string;
  runs: Run[];
  activeEntryCount: number;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const latest = runs[0];
  const dropWarning = computeDropWarning(runs);

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/eval/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { problem?: string } | null;
        toast.error(body?.problem ?? `Eval run failed (${res.status}).`);
        return;
      }
      toast.success('Eval run complete.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <header className="flex items-center justify-between">
        <div>
          <span className="caption text-text-subtle">Regression</span>
          <h2 className="font-display text-h2 font-medium tracking-tight text-text">
            Eval pass-rate
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={running || activeEntryCount === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors duration-micro ease-enter hover:bg-accent/90 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run now'}
        </button>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <span className="caption text-text-subtle">Latest</span>
          <p className="font-display text-display-2 tabular-nums text-text">
            {latest ? `${Math.round(latest.passRate * 100)}%` : '—'}
          </p>
          {latest ? (
            <p className="text-[12px] tabular-nums text-text-subtle">
              {latest.passed}/{latest.total} entries · {formatRelative(latest.ranAt)}
            </p>
          ) : (
            <p className="text-[12px] text-text-subtle">No runs yet.</p>
          )}
        </div>
        <div className="col-span-2 space-y-1">
          <span className="caption text-text-subtle">Last 14 runs</span>
          <Sparkline runs={runs} />
        </div>
      </div>

      {activeEntryCount === 0 ? (
        <p className="mt-4 rounded-sm border border-border bg-surface-2 p-3 text-[13px] text-text-muted">
          No active eval entries for this skill. Promote feedback in the inbox
          to start grading regressions.
        </p>
      ) : null}

      {dropWarning ? (
        <div className="mt-4 rounded-sm border border-warning/40 bg-warning/10 p-3 text-[13px] text-text">
          <span className="font-medium text-warning">Heads up: </span>
          pass-rate dropped {dropWarning.deltaPct.toFixed(1)}pp in the last 24h
          (from {Math.round(dropWarning.baseline * 100)}% to{' '}
          {Math.round(dropWarning.current * 100)}%).
        </div>
      ) : null}
    </section>
  );
}

function Sparkline({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return <div className="h-10 text-[12px] text-text-subtle">No data.</div>;
  }
  // Runs are newest-first; render oldest→newest left→right.
  const points = [...runs].reverse();
  const w = 240;
  const h = 40;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - p.passRate * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-10 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-text-muted"
      />
    </svg>
  );
}

/**
 * Drop warning: trigger when the latest run is more than 10 percentage points
 * below the average of all runs in the trailing 24h (excluding the latest).
 * If there's no prior run in that window, no warning.
 */
function computeDropWarning(runs: Run[]): {
  baseline: number;
  current: number;
  deltaPct: number;
} | null {
  if (runs.length < 2) return null;
  const latest = runs[0]!;
  const latestTs = Date.parse(latest.ranAt);
  if (Number.isNaN(latestTs)) return null;
  const cutoff = latestTs - 24 * 60 * 60 * 1000;
  const prior = runs
    .slice(1)
    .filter((r) => Date.parse(r.ranAt) >= cutoff);
  if (prior.length === 0) return null;
  const baseline =
    prior.reduce((acc, r) => acc + r.passRate, 0) / prior.length;
  const deltaPct = (baseline - latest.passRate) * 100;
  if (deltaPct <= 10) return null;
  return { baseline, current: latest.passRate, deltaPct };
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaMs = Date.now() - t;
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
