'use client';
import { useState } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';

interface Props {
  meta: ConnectorMeta;
  status: 'connected' | 'disconnected';
  connectedAs?: string;
}

export function ConnectorRow({ meta, status, connectedAs }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/initiate`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      if (body.authorizeUrl) {
        window.location.href = body.authorizeUrl;
        return;
      }
      setError('unexpected response from initiate');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 dark:border-gray-800">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{meta.displayName}</span>
          {status === 'connected' ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-200">
              Connected ✓ {connectedAs ? `(${connectedAs})` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
              Not connected
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">{meta.description}</p>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
      <button
        onClick={connect}
        disabled={busy}
        className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
      >
        {status === 'connected' ? 'Reconnect' : 'Connect'}
      </button>
    </div>
  );
}
