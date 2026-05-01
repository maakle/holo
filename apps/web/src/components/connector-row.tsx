'use client';
import { useState } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';

interface Props {
  meta: ConnectorMeta;
  status: 'connected' | 'disconnected';
  connectedAs?: string;
}

function placeholderForConnector(id: ConnectorMeta['id']): string {
  if (id === 'notion') return 'Notion integration token (secret_...)';
  if (id === 'pylon') return 'Pylon API key';
  return 'API key or token';
}

export function ConnectorRow({ meta, status, connectedAs }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // ── OAuth flow ──────────────────────────────────────────────────────────────
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

  // ── API-key flow ─────────────────────────────────────────────────────────────
  async function saveApiKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? 'Connection failed');
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const isApiKey = meta.flowType === 'apikey';
  const showForm = isApiKey && (status === 'disconnected' || showApiKeyForm);

  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 dark:border-gray-800">
      <div className="flex-1 min-w-0">
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
        {showForm ? (
          <form onSubmit={saveApiKey} className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={placeholderForConnector(meta.id)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#3F47FF] dark:border-gray-700 dark:bg-gray-900"
              autoComplete="off"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !tokenInput.trim()}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              Save
            </button>
            {status === 'connected' ? (
              <button
                type="button"
                onClick={() => { setShowApiKeyForm(false); setError(null); setTokenInput(''); }}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
              >
                Cancel
              </button>
            ) : null}
          </form>
        ) : null}
      </div>
      {isApiKey ? (
        status === 'connected' && !showApiKeyForm ? (
          <button
            onClick={() => { setShowApiKeyForm(true); setError(null); }}
            className="ml-4 rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Reconnect
          </button>
        ) : null
      ) : (
        <button
          onClick={connect}
          disabled={busy}
          className="ml-4 rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          {status === 'connected' ? 'Reconnect' : 'Connect'}
        </button>
      )}
    </div>
  );
}
