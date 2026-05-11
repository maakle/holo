'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { RefreshCw, Search } from 'lucide-react';

export function Toolbar({
  query,
  stats,
}: {
  query: string;
  stats: { total: number; errors: number; replays: number; replayViewers: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = useState(query);
  const [isPending, startTransition] = useTransition();

  // Sync local input when query param changes externally.
  useEffect(() => {
    setValue(query);
  }, [query]);

  const submit = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete('cursor');
    const v = value.trim();
    if (v) next.set('q', v);
    else next.delete('q');
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  return (
    <div
      className="flex h-12 shrink-0 items-center gap-3 border-b px-4"
      style={{ borderColor: 'var(--border)' }}
    >
      <h1
        className="font-display text-[15px] font-semibold tracking-tight"
        style={{ color: 'var(--text)' }}
      >
        Logs
      </h1>
      <span className="text-[12px]" style={{ color: 'var(--text-subtle)' }}>
        {stats.total.toLocaleString()} events · {stats.errors.toLocaleString()} errors
        {stats.replayViewers > 0 ? (
          <>
            {' · '}
            <span title={`${stats.replays.toLocaleString()} replays opened in total`}>
              {stats.replayViewers.toLocaleString()} replay viewer
              {stats.replayViewers === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
      </span>

      <div className="ml-4 flex min-w-0 flex-1 items-center">
        <div
          className="flex h-8 w-full max-w-xl items-center gap-2 rounded-sm border px-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <Search size={13} style={{ color: 'var(--text-subtle)' }} />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            onBlur={submit}
            placeholder="Search by tool, agent, trace…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-subtle"
            style={{ color: 'var(--text)' }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        className="inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-colors hover:bg-surface-2 disabled:opacity-50"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        aria-label="Refresh"
      >
        <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
