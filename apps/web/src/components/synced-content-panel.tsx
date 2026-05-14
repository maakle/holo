'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onSyncTriggered } from '@/lib/sync-events';

type Stats = {
  kinds: Array<{
    kind: string;
    label: string;
    artifactCount: number;
    chunkCount: number;
  }>;
  totals: { artifactCount: number; chunkCount: number };
  fileRoot: string | null;
};

interface Props {
  provider: string;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export function SyncedContentPanel({ provider }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/connectors/${provider}/stats`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as
          | Stats
          | { problem?: string; fix?: string };
        if (cancelled) return;
        if (!res.ok) {
          const err = body as { problem?: string; fix?: string };
          setError(err.fix ?? err.problem ?? `HTTP ${res.status}`);
          return;
        }
        setStats(body as Stats);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    // Refresh after Sync now / channel-picker save / OAuth reconnect — the
    // same hook the history panel uses, so both sections stay in lockstep.
    const off = onSyncTriggered(provider, () => {
      void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [provider]);

  if (loading && !stats) {
    return <div className="text-[12px] text-text-muted">Loading…</div>;
  }
  if (error && !stats) {
    return <div className="text-[12px] text-error">{error}</div>;
  }
  if (!stats) return null;

  if (stats.totals.artifactCount === 0 && stats.totals.chunkCount === 0) {
    return (
      <div className="rounded-md border border-border bg-bg px-3 py-3 text-[12px] text-text-muted">
        Nothing indexed yet — trigger a sync to populate this connector.
      </div>
    );
  }

  const href = stats.fileRoot ? `/files${stats.fileRoot}` : null;

  // Single-kind connectors get a one-line summary; a 1-row table is dishonest
  // structure. Connectors with 2+ kinds (GitHub, HubSpot) get the full table
  // so each entity type is legible.
  if (stats.kinds.length === 1) {
    const k = stats.kinds[0]!;
    const body = (
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] text-text">
          <span className="font-medium">{fmt(k.artifactCount)}</span>{' '}
          <span>{k.label}</span>
          <span className="text-text-muted">
            {' '}
            · {fmt(k.chunkCount)} {k.chunkCount === 1 ? 'chunk' : 'chunks'} indexed
          </span>
        </div>
        {href ? (
          <span className="shrink-0 text-[12px] text-text-muted transition-colors group-hover:text-text">
            Open in Files →
          </span>
        ) : null}
      </div>
    );
    if (href) {
      return (
        <Link
          href={href}
          className="group block rounded-md border border-border bg-bg px-4 py-3 [font-variant-numeric:tabular-nums] transition-colors hover:border-border-strong"
        >
          {body}
        </Link>
      );
    }
    return (
      <div className="rounded-md border border-border bg-bg px-4 py-3 [font-variant-numeric:tabular-nums]">
        {body}
      </div>
    );
  }

  const tableEl = (
    <div className="rounded-md border border-border bg-bg [font-variant-numeric:tabular-nums] transition-colors group-hover/synced:border-border-strong">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Kind
            </th>
            <th className="px-4 py-2.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Items
            </th>
            <th className="px-4 py-2.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Chunks
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.kinds.map((k) => (
            <tr key={k.kind} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2.5 text-[13px] text-text">{k.label}</td>
              <td className="px-4 py-2.5 text-right text-[13px] text-text">
                {fmt(k.artifactCount)}
              </td>
              <td className="px-4 py-2.5 text-right text-[13px] text-text-muted">
                {fmt(k.chunkCount)}
              </td>
            </tr>
          ))}
          <tr className="bg-surface-2">
            <td className="px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Total
            </td>
            <td className="px-4 py-2.5 text-right text-[13px] font-medium text-text">
              {fmt(stats.totals.artifactCount)}
            </td>
            <td className="px-4 py-2.5 text-right text-[13px] font-medium text-text">
              {fmt(stats.totals.chunkCount)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  if (!href) return tableEl;
  return (
    <Link href={href} className="group/synced block">
      {tableEl}
      <div className="mt-1.5 text-right text-[12px] text-text-muted transition-colors group-hover/synced:text-text">
        Open in Files →
      </div>
    </Link>
  );
}
