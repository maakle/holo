'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';

interface Invocation {
  id: string;
  createdAt: Date;
  agentIdentity: string | null;
  toolName: string;
  latencyMs: number;
  errorCode: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
}

interface InvocationTableProps {
  invocations: Invocation[];
}

function StatusBadge({ errorCode }: { errorCode: string | null }) {
  if (errorCode) {
    return (
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
        style={{
          background: 'color-mix(in srgb, var(--error) 12%, transparent)',
          color: 'var(--error)',
        }}
      >
        error
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        background: 'color-mix(in srgb, var(--success) 12%, transparent)',
        color: 'var(--success)',
      }}
    >
      success
    </span>
  );
}

function outputPreview(outputJson: Record<string, unknown> | null): string {
  if (!outputJson) return '—';
  const str = JSON.stringify(outputJson);
  return str.length > 80 ? str.slice(0, 80) + '…' : str;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function InvocationTable({ invocations }: InvocationTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (invocations.length === 0) {
    return (
      <div
        className="rounded border py-12 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No agent invocations yet. Connect your agent to get started.
        </p>
        <Link
          href="/connect-agent"
          className="mt-3 inline-block text-sm"
          style={{ color: '#3F47FF' }}
        >
          Connect your agent →
        </Link>
      </div>
    );
  }

  return (
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
            {['Timestamp (UTC)', 'Agent Identity', 'Tool', 'Latency (ms)', 'Status', 'Output Preview'].map(
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
          {invocations.map((inv) => {
            const isExpanded = expandedId === inv.id;
            return (
              <Fragment key={inv.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                  onMouseEnter={() => setHoveredId(inv.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="border-b last:border-0 cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    background: isExpanded || hoveredId === inv.id ? 'var(--surface-2)' : undefined,
                    borderLeft: isExpanded ? '2px solid #3F47FF' : '2px solid transparent',
                  }}
                >
                  <td
                    className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatUtc(inv.createdAt)}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                    {inv.agentIdentity ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text)' }}>
                    {inv.toolName}
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {inv.latencyMs}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge errorCode={inv.errorCode} />
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs truncate max-w-xs"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    {outputPreview(inv.outputJson)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr
                    key={`${inv.id}-expanded`}
                    style={{ background: 'var(--surface)' }}
                  >
                    <td
                      colSpan={6}
                      className="px-6 py-5 border-b"
                      style={{ borderColor: 'var(--border)', borderLeft: '2px solid #3F47FF' }}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
                        <div className="flex-1 min-w-0">
                          <div
                            className="mb-2 text-xs font-medium uppercase tracking-widest"
                            style={{ color: 'var(--text-subtle)' }}
                          >
                            Input
                          </div>
                          <pre
                            className="rounded p-3 overflow-auto text-xs leading-5 font-mono"
                            style={{
                              background: 'var(--code-bg)',
                              color: 'var(--text)',
                              borderRadius: '4px',
                              maxHeight: '320px',
                            }}
                          >
                            {JSON.stringify(inv.inputJson, null, 2)}
                          </pre>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className="mb-2 text-xs font-medium uppercase tracking-widest"
                            style={{ color: 'var(--text-subtle)' }}
                          >
                            Output
                          </div>
                          <pre
                            className="rounded p-3 overflow-auto text-xs leading-5 font-mono"
                            style={{
                              background: 'var(--code-bg)',
                              color: inv.errorCode ? 'var(--error)' : 'var(--text)',
                              borderRadius: '4px',
                              maxHeight: '320px',
                            }}
                          >
                            {inv.outputJson
                              ? JSON.stringify(inv.outputJson, null, 2)
                              : inv.errorCode
                                ? `Error: ${inv.errorCode}`
                                : 'null'}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
