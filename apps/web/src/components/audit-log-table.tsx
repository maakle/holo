'use client';

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

export function AuditLogTable({ events }: { events: AuditEvent[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>
        No audit events yet. Skill executions, token creation, and publish actions appear here.
      </p>
    );
  }

  return (
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
  );
}
