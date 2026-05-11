'use client';

import { formatTime } from './format';
import { KIND_SHORT } from './kinds';
import type { EventRow } from './types';

export function LogTable({
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
      <span style={{ color: 'var(--text-subtle)' }}>{formatTime(event.createdAt)}</span>
      <span className="flex min-w-0 items-center">
        <StatusTag hasError={hasError} />
      </span>
      <span className="truncate" style={{ color: 'var(--text-muted)' }}>
        {event.agentIdentity ?? '—'}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{KIND_SHORT[event.kind] ?? event.kind}</span>
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
