'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { AgentEventKind } from '@holo/db';

export interface EventRow {
  id: string;
  createdAt: Date;
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
}

interface TraceGroup {
  traceId: string;
  events: EventRow[];
  startedAt: Date;
  endedAt: Date;
  hasError: boolean;
  agentIdentity: string | null;
  kindCounts: Map<AgentEventKind, number>;
  totalLatencyMs: number;
}

interface UngroupedRow {
  kind: 'event';
  event: EventRow;
}
interface GroupedRow {
  kind: 'trace';
  group: TraceGroup;
}
type Row = UngroupedRow | GroupedRow;

const KIND_LABELS: Record<AgentEventKind, string> = {
  mcp_call: 'MCP',
  mcp_list: 'list',
  llm_call: 'LLM',
  slack_message: 'Slack',
  agent_step: 'step',
  tool_call: 'tool',
  connector_sync: 'sync',
  rest_call: 'REST',
};

function groupByTrace(events: EventRow[]): Row[] {
  const groups = new Map<string, TraceGroup>();
  const out: Row[] = [];
  for (const e of events) {
    if (!e.traceId) {
      out.push({ kind: 'event', event: e });
      continue;
    }
    const existing = groups.get(e.traceId);
    if (existing) {
      existing.events.push(e);
      if (e.createdAt < existing.startedAt) existing.startedAt = e.createdAt;
      if (e.createdAt > existing.endedAt) existing.endedAt = e.createdAt;
      existing.hasError ||= !!e.errorCode;
      existing.kindCounts.set(e.kind, (existing.kindCounts.get(e.kind) ?? 0) + 1);
      existing.totalLatencyMs += e.latencyMs;
      existing.agentIdentity ??= e.agentIdentity;
    } else {
      const g: TraceGroup = {
        traceId: e.traceId,
        events: [e],
        startedAt: e.createdAt,
        endedAt: e.createdAt,
        hasError: !!e.errorCode,
        agentIdentity: e.agentIdentity,
        kindCounts: new Map([[e.kind, 1]]),
        totalLatencyMs: e.latencyMs,
      };
      groups.set(e.traceId, g);
      out.push({ kind: 'trace', group: g });
    }
  }
  // Sort each group's events oldest-first for natural reading order in expand
  for (const g of groups.values()) {
    g.events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return out;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function StatusBadge({ hasError }: { hasError: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        background: hasError
          ? 'color-mix(in srgb, var(--error) 12%, transparent)'
          : 'color-mix(in srgb, var(--success) 12%, transparent)',
        color: hasError ? 'var(--error)' : 'var(--success)',
      }}
    >
      {hasError ? 'error' : 'success'}
    </span>
  );
}

function KindBadge({ kind }: { kind: AgentEventKind }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
      style={{
        background: 'var(--surface-2)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function tokenSummary(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const i = metadata.inputTokens;
  const o = metadata.outputTokens;
  if (typeof i !== 'number' && typeof o !== 'number') return null;
  return `${typeof i === 'number' ? i : '?'}→${typeof o === 'number' ? o : '?'} tok`;
}

function previewText(event: EventRow): string {
  if (event.kind === 'slack_message') {
    const text = (event.inputJson?.text ?? event.outputJson?.answer) as unknown;
    if (typeof text === 'string') return truncate(text, 80);
  }
  if (event.kind === 'llm_call') {
    return tokenSummary(event.metadata) ?? event.toolName;
  }
  const out = event.outputJson;
  if (!out) return event.errorCode ?? '—';
  const str = JSON.stringify(out);
  return truncate(str, 80);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function InvocationTable({ events, nextCursor }: Props) {
  const rows = useMemo(() => groupByTrace(events), [events]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div
        className="rounded border py-12 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No agent activity matches the current filters.
        </p>
        <Link
          href="/connect-agent"
          className="mt-3 inline-block text-sm"
          style={{ color: '#3F47FF' }}
        >
          Connect an agent →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded overflow-hidden border"
        style={{ borderColor: 'var(--border)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--surface)' }}>
            <tr
              className="border-b text-left"
              style={{ borderColor: 'var(--border)' }}
            >
              {['Time (UTC)', 'Agent', 'Kind', 'Name', 'Latency', 'Status', 'Preview'].map(
                (col) => (
                  <th
                    key={col}
                    className="px-4 py-2 text-xs font-medium uppercase tracking-widest"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === 'event') {
                return (
                  <EventTableRow
                    key={row.event.id}
                    event={row.event}
                    expanded={expandedKey === row.event.id}
                    onToggle={() =>
                      setExpandedKey((cur) => (cur === row.event.id ? null : row.event.id))
                    }
                  />
                );
              }
              const key = `trace-${row.group.traceId}`;
              return (
                <TraceTableRow
                  key={key}
                  group={row.group}
                  expanded={expandedKey === key}
                  onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor ? <LoadMoreButton cursor={nextCursor} /> : null}
    </div>
  );
}

function LoadMoreButton({ cursor }: { cursor: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={() => {
          const next = new URLSearchParams(sp.toString());
          next.set('cursor', cursor);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded border px-3 py-1.5 text-[13px] font-medium"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-muted)',
          background: 'var(--surface-2)',
        }}
      >
        Older →
      </button>
    </div>
  );
}

function EventTableRow({
  event,
  expanded,
  onToggle,
}: {
  event: EventRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className="border-b last:border-0 cursor-pointer transition-colors hover:bg-surface-2"
        style={{
          borderColor: 'var(--border)',
          background: expanded ? 'var(--surface-2)' : undefined,
          borderLeft: expanded ? '2px solid #3F47FF' : '2px solid transparent',
        }}
      >
        <td
          className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap"
          style={{ color: 'var(--text-muted)' }}
        >
          {formatUtc(event.createdAt)}
        </td>
        <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
          {event.agentIdentity ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}
        </td>
        <td className="px-4 py-3">
          <KindBadge kind={event.kind} />
        </td>
        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text)' }}>
          {event.toolName}
        </td>
        <td
          className="px-4 py-3 font-mono text-xs tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {event.latencyMs}ms
        </td>
        <td className="px-4 py-3">
          <StatusBadge hasError={!!event.errorCode} />
        </td>
        <td
          className="px-4 py-3 font-mono text-xs truncate max-w-xs"
          style={{ color: 'var(--text-subtle)' }}
        >
          {previewText(event)}
        </td>
      </tr>
      {expanded ? (
        <tr style={{ background: 'var(--surface)' }}>
          <td
            colSpan={7}
            className="px-6 py-5 border-b"
            style={{ borderColor: 'var(--border)', borderLeft: '2px solid #3F47FF' }}
          >
            <EventDetail event={event} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function TraceTableRow({
  group,
  expanded,
  onToggle,
}: {
  group: TraceGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const kindSummary = Array.from(group.kindCounts.entries())
    .map(([k, n]) => `${KIND_LABELS[k] ?? k}×${n}`)
    .join(' · ');
  const root = group.events[0]!;
  const rootName =
    root.kind === 'slack_message' && typeof root.inputJson?.text === 'string'
      ? truncate(root.inputJson.text as string, 60)
      : group.events.find((e) => e.kind === 'slack_message')?.inputJson?.text;
  const displayName =
    typeof rootName === 'string' ? truncate(rootName, 60) : `trace ${group.traceId.slice(0, 8)}`;
  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className="border-b last:border-0 cursor-pointer transition-colors hover:bg-surface-2"
        style={{
          borderColor: 'var(--border)',
          background: expanded ? 'var(--surface-2)' : undefined,
          borderLeft: expanded ? '2px solid #3F47FF' : '2px solid transparent',
        }}
      >
        <td
          className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap"
          style={{ color: 'var(--text-muted)' }}
        >
          {formatUtc(group.endedAt)}
        </td>
        <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
          {group.agentIdentity ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}
        </td>
        <td className="px-4 py-3">
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium"
            style={{ background: '#3F47FF', color: 'white' }}
          >
            trace · {group.events.length}
          </span>
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text)' }}>
          {displayName}
        </td>
        <td
          className="px-4 py-3 font-mono text-xs tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {group.totalLatencyMs}ms
        </td>
        <td className="px-4 py-3">
          <StatusBadge hasError={group.hasError} />
        </td>
        <td
          className="px-4 py-3 text-xs truncate max-w-xs"
          style={{ color: 'var(--text-subtle)' }}
        >
          {kindSummary}
        </td>
      </tr>
      {expanded ? (
        <tr style={{ background: 'var(--surface)' }}>
          <td
            colSpan={7}
            className="px-6 py-5 border-b"
            style={{ borderColor: 'var(--border)', borderLeft: '2px solid #3F47FF' }}
          >
            <div className="flex flex-col gap-2">
              {group.events.map((e) => (
                <details
                  key={e.id}
                  className="rounded border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                >
                  <summary className="cursor-pointer px-3 py-2 text-xs flex items-center gap-3">
                    <span style={{ color: 'var(--text-subtle)', fontFamily: 'monospace' }}>
                      {formatUtc(e.createdAt)}
                    </span>
                    <KindBadge kind={e.kind} />
                    <span className="font-mono" style={{ color: 'var(--text)' }}>
                      {e.toolName}
                    </span>
                    <span
                      className="font-mono tabular-nums"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {e.latencyMs}ms
                    </span>
                    {e.errorCode ? <StatusBadge hasError /> : null}
                    <span
                      className="ml-auto truncate"
                      style={{ color: 'var(--text-subtle)', fontFamily: 'monospace' }}
                    >
                      {previewText(e)}
                    </span>
                  </summary>
                  <div className="px-3 pb-3">
                    <EventDetail event={e} />
                  </div>
                </details>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function EventDetail({ event }: { event: EventRow }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <DetailPane label="Input" value={event.inputJson} />
      <DetailPane
        label="Output"
        value={event.outputJson ?? (event.errorCode ? { error: event.errorCode } : null)}
        tone={event.errorCode ? 'error' : undefined}
      />
      {event.metadata ? <DetailPane label="Metadata" value={event.metadata} /> : null}
      <div className="flex flex-col justify-end">
        <Link
          href={`/observability/${event.id}`}
          className="text-xs font-medium"
          style={{ color: '#3F47FF' }}
          onClick={(e) => e.stopPropagation()}
        >
          Open replay →
        </Link>
      </div>
    </div>
  );
}

function DetailPane({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone?: 'error';
}) {
  return (
    <div className="flex-1 min-w-0">
      <div
        className="mb-2 text-xs font-medium uppercase tracking-widest"
        style={{ color: 'var(--text-subtle)' }}
      >
        {label}
      </div>
      <pre
        className="rounded p-3 overflow-auto text-xs leading-5 font-mono"
        style={{
          background: 'var(--code-bg)',
          color: tone === 'error' ? 'var(--error)' : 'var(--text)',
          borderRadius: '4px',
          maxHeight: '320px',
        }}
      >
        {value === null || value === undefined ? 'null' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
