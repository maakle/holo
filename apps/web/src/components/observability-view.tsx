'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import type { AgentEventKind } from '@holo/db';

export interface EventRow {
  id: string;
  createdAt: string; // ISO
  kind: AgentEventKind;
  traceId: string | null;
  agentIdentity: string | null;
  toolName: string;
  latencyMs: number;
  errorCode: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface Props {
  events: EventRow[];
  nextCursor: string | null;
  kind: string | undefined;
  status: string | undefined;
  query: string;
  availableKinds: readonly string[];
  stats: { total: number; errors: number };
}

const KIND_LABELS: Record<string, string> = {
  mcp_call: 'MCP tool',
  mcp_list: 'tools/list',
  llm_call: 'LLM',
  slack_message: 'Slack',
  agent_step: 'Agent step',
  tool_call: 'Tool call',
  connector_sync: 'Sync',
  rest_call: 'REST',
};

const KIND_SHORT: Record<string, string> = {
  mcp_call: 'MCP',
  mcp_list: 'list',
  llm_call: 'LLM',
  slack_message: 'Slack',
  agent_step: 'step',
  tool_call: 'tool',
  connector_sync: 'sync',
  rest_call: 'REST',
};

export function ObservabilityView({
  events,
  nextCursor,
  kind,
  status,
  query,
  availableKinds,
  stats,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );

  // Close drawer on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="-mx-6 -my-8 lg:-mx-10 lg:-my-10 flex h-[calc(100vh-56px)] min-h-0">
      <FilterRail
        kind={kind}
        status={status}
        availableKinds={availableKinds}
        stats={stats}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar query={query} stats={stats} />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-auto">
            <LogTable
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {nextCursor ? <LoadMoreButton cursor={nextCursor} /> : null}
            {events.length === 0 ? <EmptyState /> : null}
          </div>
          {selected ? (
            <DetailDrawer event={selected} onClose={() => setSelectedId(null)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Filter rail ----------

function FilterRail({
  kind,
  status,
  availableKinds,
  stats,
}: {
  kind: string | undefined;
  status: string | undefined;
  availableKinds: readonly string[];
  stats: { total: number; errors: number };
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
        <FilterRadio
          label="All"
          active={!kind}
          onClick={() => setParam('kind', undefined)}
        />
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
        <span
          className="text-[12px] font-medium"
          style={{ color: 'var(--text)' }}
        >
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

// ---------- Top toolbar ----------

function Toolbar({
  query,
  stats,
}: {
  query: string;
  stats: { total: number; errors: number };
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

// ---------- Log table ----------

function LogTable({
  events,
  selectedId,
  onSelect,
}: {
  events: EventRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="flex flex-col">
      <div
        className="sticky top-0 z-10 grid border-b px-4 py-1.5 text-[11px] font-medium tracking-[0.04em]"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-subtle)',
          background: 'var(--bg)',
          gridTemplateColumns: '180px 80px 1fr 80px 1fr',
          columnGap: '16px',
        }}
      >
        <span>Time</span>
        <span>Status</span>
        <span>Agent</span>
        <span>Kind</span>
        <span>Request</span>
      </div>
      {events.map((e) => (
        <LogRow
          key={e.id}
          event={e}
          selected={selectedId === e.id}
          onClick={() => onSelect(e.id)}
        />
      ))}
    </div>
  );
}

function LogRow({
  event,
  selected,
  onClick,
}: {
  event: EventRow;
  selected: boolean;
  onClick: () => void;
}) {
  const hasError = !!event.errorCode;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full cursor-pointer items-center px-4 py-1.5 text-left font-mono text-[12px] tabular-nums transition-colors ${
        selected ? '' : 'hover:bg-surface-2'
      }`}
      style={{
        gridTemplateColumns: '180px 60px 1fr 80px 1fr',
        columnGap: '16px',
        ...(selected ? { background: 'var(--surface-2)' } : null),
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
    >
      <span style={{ color: 'var(--text-subtle)' }}>
        {formatTime(event.createdAt)}
      </span>
      <span className="flex min-w-0 items-center">
        <StatusTag hasError={hasError} />
      </span>
      <span className="truncate" style={{ color: 'var(--text-muted)' }}>
        {event.agentIdentity ?? '—'}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        {KIND_SHORT[event.kind] ?? event.kind}
      </span>
      <span className="truncate" style={{ color: 'var(--text)' }}>
        {event.toolName}
        <span className="ml-3" style={{ color: 'var(--text-subtle)' }}>
          {event.latencyMs}ms
        </span>
      </span>
    </button>
  );
}

function StatusTag({ hasError }: { hasError: boolean }) {
  const label = hasError ? 'error' : 'ok';
  const tone = hasError ? 'var(--error)' : 'var(--success)';
  return (
    <span
      className="inline-flex h-[18px] max-w-full items-center overflow-hidden whitespace-nowrap rounded-sm px-1.5 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.04em]"
      title={label}
      style={{
        background: hasError
          ? 'color-mix(in srgb, var(--error) 12%, transparent)'
          : 'color-mix(in srgb, var(--success) 12%, transparent)',
        color: tone,
      }}
    >
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, 2);
  return `${month} ${day} ${hh}:${mm}:${ss}.${ms}`;
}

// ---------- Drawer ----------

function DetailDrawer({
  event,
  onClose,
}: {
  event: EventRow;
  onClose: () => void;
}) {
  const hasError = !!event.errorCode;
  return (
    <aside
      className="flex w-full max-w-[480px] shrink-0 flex-col overflow-y-auto border-l"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            {KIND_SHORT[event.kind] ?? event.kind}
          </span>
          <span
            className="truncate font-mono text-[13px]"
            style={{ color: 'var(--text)' }}
          >
            {event.toolName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="font-mono text-[11px]"
            style={{
              color: hasError ? 'var(--error)' : 'var(--success)',
            }}
          >
            {hasError ? 'error' : 'ok'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-surface-2"
            aria-label="Close"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <DetailField label="Request started" value={formatTimeFull(event.createdAt)} mono />
        {event.traceId ? (
          <DetailField label="Trace ID" value={event.traceId} mono />
        ) : null}
        <DetailField label="Event ID" value={event.id} mono />
        {event.agentIdentity ? (
          <DetailField label="Agent" value={event.agentIdentity} mono />
        ) : null}
        <DetailField label="Latency" value={`${event.latencyMs}ms`} mono />
        {event.errorCode ? (
          <DetailField label="Error" value={event.errorCode} mono tone="error" />
        ) : null}
      </div>

      <DetailSection title="Input" value={event.inputJson} />
      <DetailSection
        title="Output"
        value={event.outputJson ?? (event.errorCode ? { error: event.errorCode } : null)}
        tone={event.errorCode ? 'error' : undefined}
      />
      {event.metadata ? <DetailSection title="Metadata" value={event.metadata} /> : null}

      <div className="px-4 py-4">
        <Link
          href={`/observability/${event.id}`}
          className="text-[13px] font-medium"
          style={{ color: 'var(--accent)' }}
        >
          Open replay →
        </Link>
      </div>
    </aside>
  );
}

function DetailField({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'error';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className="text-[12px]"
        style={{ color: 'var(--text-subtle)' }}
      >
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right text-[12px] ${mono ? 'font-mono tabular-nums' : ''}`}
        style={{
          color: tone === 'error' ? 'var(--error)' : 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailSection({
  title,
  value,
  tone,
}: {
  title: string;
  value: unknown;
  tone?: 'error';
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5"
      >
        {open ? (
          <ChevronDown size={12} style={{ color: 'var(--text-subtle)' }} />
        ) : (
          <ChevronRight size={12} style={{ color: 'var(--text-subtle)' }} />
        )}
        <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>
          {title}
        </span>
      </button>
      {open ? (
        <div className="px-4 pb-4">
          <pre
            className="overflow-auto rounded p-3 font-mono text-[12px] leading-5"
            style={{
              background: 'var(--code-bg)',
              color: tone === 'error' ? 'var(--error)' : 'var(--text)',
              maxHeight: '320px',
            }}
          >
            {value === null || value === undefined
              ? 'null'
              : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function formatTimeFull(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ---------- Misc ----------

function LoadMoreButton({ cursor }: { cursor: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="flex justify-center px-4 py-4">
      <button
        type="button"
        onClick={() => {
          const next = new URLSearchParams(sp.toString());
          next.set('cursor', cursor);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded-sm border px-3 py-1.5 text-[12px] font-medium"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-muted)',
          background: 'var(--surface-2)',
        }}
      >
        Load older →
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="text-center">
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No agent activity matches the current filters.
        </p>
        <Link
          href="/connect-agent"
          className="mt-3 inline-block text-[13px]"
          style={{ color: 'var(--accent)' }}
        >
          Connect an agent →
        </Link>
      </div>
    </div>
  );
}
