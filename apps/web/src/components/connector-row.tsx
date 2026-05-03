'use client';
import { useState } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

  const isApiKey = meta.flowType === 'apikey';
  const showForm = isApiKey && (status === 'disconnected' || showApiKeyForm);

  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 transition-colors duration-micro hover:bg-surface-2/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text">{meta.displayName}</span>
          {status === 'connected' ? (
            <Badge variant="success">
              Connected{connectedAs ? ` · ${connectedAs}` : ''}
            </Badge>
          ) : (
            <Badge variant="neutral">Not connected</Badge>
          )}
        </div>
        <p className="mt-1 text-[13px] leading-5 text-text-muted">{meta.description}</p>
        {error ? <p className="mt-2 text-[12px] text-error">{error}</p> : null}
        {showForm ? (
          <form onSubmit={saveApiKey} className="mt-3 flex items-center gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={placeholderForConnector(meta.id)}
              className="flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
              autoComplete="off"
              disabled={busy}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={busy || !tokenInput.trim()}>
              Save
            </Button>
            {status === 'connected' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowApiKeyForm(false);
                  setError(null);
                  setTokenInput('');
                }}
              >
                Cancel
              </Button>
            ) : null}
          </form>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5">
        {isApiKey ? (
          status === 'connected' && !showApiKeyForm ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowApiKeyForm(true);
                setError(null);
              }}
            >
              Reconnect
            </Button>
          ) : null
        ) : (
          <Button
            variant={status === 'connected' ? 'secondary' : 'primary'}
            size="sm"
            onClick={connect}
            disabled={busy}
          >
            {status === 'connected' ? 'Reconnect' : 'Connect'}
          </Button>
        )}
      </div>
    </div>
  );
}
