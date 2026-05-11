'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { formatTimeFull } from './format';
import { KIND_SHORT } from './kinds';
import type { EventRow } from './types';

export function DetailDrawer({ event, onClose }: { event: EventRow; onClose: () => void }) {
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
          <span className="truncate font-mono text-[13px]" style={{ color: 'var(--text)' }}>
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
        {event.traceId ? <DetailField label="Trace ID" value={event.traceId} mono /> : null}
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
      <span className="text-[12px]" style={{ color: 'var(--text-subtle)' }}>
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

function DetailSection({ title, value, tone }: { title: string; value: unknown; tone?: 'error' }) {
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
            {value === null || value === undefined ? 'null' : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
