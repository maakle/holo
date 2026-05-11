'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { KIND_LABELS } from './kinds';

export function FilterRail({
  kind,
  status,
  availableKinds,
  stats,
}: {
  kind: string | undefined;
  status: string | undefined;
  availableKinds: readonly string[];
  stats: { total: number; errors: number; replays: number; replayViewers: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(sp.toString());
    next.delete('cursor');
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const reset = () => {
    startTransition(() => router.push(pathname));
  };

  const hasActive = !!kind || !!status || !!sp.get('q');

  return (
    <aside
      className="hidden w-[240px] shrink-0 flex-col overflow-y-auto border-r md:flex"
      style={{ borderColor: 'var(--border)' }}
    >
      <div
        className="flex h-12 shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          className="text-[11px] font-medium uppercase tracking-[0.04em]"
          style={{ color: 'var(--text-subtle)' }}
        >
          Filters
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={!hasActive}
          className="text-[12px] disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}
        >
          Reset
        </button>
      </div>

      <FilterGroup label="Status">
        <FilterRadio
          label="All"
          active={!status}
          onClick={() => setParam('status', undefined)}
          count={stats.total}
        />
        <FilterRadio
          label="Errors only"
          active={status === 'error'}
          onClick={() => setParam('status', 'error')}
          count={stats.errors}
          tone="error"
        />
      </FilterGroup>

      <FilterGroup label="Kind">
        <FilterRadio label="All" active={!kind} onClick={() => setParam('kind', undefined)} />
        {availableKinds.map((k) => (
          <FilterRadio
            key={k}
            label={KIND_LABELS[k] ?? k}
            active={kind === k}
            onClick={() => setParam('kind', k)}
          />
        ))}
      </FilterGroup>
    </aside>
  );
}

function FilterGroup({
  label,
  children,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown size={12} style={{ color: 'var(--text-subtle)' }} />
        ) : (
          <ChevronRight size={12} style={{ color: 'var(--text-subtle)' }} />
        )}
        <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>
          {label}
        </span>
      </button>
      {open ? <div className="pb-2">{children}</div> : null}
    </div>
  );
}

function FilterRadio({
  label,
  active,
  onClick,
  count,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  tone?: 'error';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between px-4 py-1.5 text-left text-[13px] transition-colors ${
        active ? '' : 'hover:bg-surface-2'
      }`}
      style={{
        ...(active ? { background: 'var(--surface-2)' } : null),
        color: active ? 'var(--text)' : 'var(--text-muted)',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-sm border"
          style={{
            borderColor: active ? 'var(--accent)' : 'var(--border-strong)',
            background: active ? 'var(--accent)' : 'transparent',
          }}
        />
        {label}
      </span>
      {typeof count === 'number' ? (
        <span
          className="font-mono tabular-nums text-[11px]"
          style={{
            color: tone === 'error' ? 'var(--error)' : 'var(--text-subtle)',
          }}
        >
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}
