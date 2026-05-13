'use client';

import Link from 'next/link';
import { useState, Fragment } from 'react';

interface AuditEvent {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
}

interface AuditLogTableProps {
  events: AuditEvent[];
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

export function AuditLogTable({ events, page, totalPages, total, pageSize }: AuditLogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0 && page === 1) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>
        No audit events yet. Skill executions, token creation, and publish actions appear here.
      </p>
    );
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Time (UTC)</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Event</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Resource</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>User</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => {
              const hasMeta = ev.meta && Object.keys(ev.meta).length > 0;
              return (
              <Fragment key={ev.id}>
                <tr
                  onClick={hasMeta ? () => setExpandedId(expandedId === ev.id ? null : ev.id) : undefined}
                  style={{ borderBottom: '1px solid var(--border)', cursor: hasMeta ? 'pointer' : 'default', background: expandedId === ev.id ? 'var(--surface-2)' : undefined }}
                >
                  <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(ev.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{ev.eventType}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                    {ev.resourceType}{ev.resourceId ? `:${ev.resourceId.slice(0, 8)}` : ''}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                    {ev.userId ? ev.userId.slice(0, 8) : '—'}
                  </td>
                </tr>
                {hasMeta && expandedId === ev.id && (
                  <tr key={`${ev.id}-meta`}>
                    <td colSpan={4} style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>
                      <pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--code-bg)', padding: 12, borderRadius: 4, overflowX: 'auto' }}>
                        {JSON.stringify(ev.meta, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          <span>
            {rangeStart}–{rangeEnd} of {total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <PageLink page={page - 1} disabled={!hasPrev}>Previous</PageLink>
            <span style={{ alignSelf: 'center' }}>
              Page {page} of {totalPages}
            </span>
            <PageLink page={page + 1} disabled={!hasNext}>Next</PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: React.ReactNode }) {
  const style: React.CSSProperties = {
    padding: '6px 12px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: disabled ? 'var(--text-subtle)' : 'var(--text)',
    background: 'transparent',
    textDecoration: 'none',
    pointerEvents: disabled ? 'none' : undefined,
    opacity: disabled ? 0.5 : 1,
  };
  if (disabled) {
    return <span style={style}>{children}</span>;
  }
  return (
    <Link href={page === 1 ? '/ee/audit' : `/ee/audit?page=${page}`} style={style}>
      {children}
    </Link>
  );
}
