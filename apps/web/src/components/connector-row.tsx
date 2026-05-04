'use client';
import { useState } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { ConnectorManageSheet } from '@/components/connector-manage-sheet';

interface AllowlistEntry {
  pattern: string;
  isGlob: boolean;
}

interface Props {
  meta: ConnectorMeta;
  status: 'connected' | 'disconnected';
  connectedAs?: string;
  allowlist?: AllowlistEntry[];
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function placeholderForConnector(id: ConnectorMeta['id']): string {
  if (id === 'notion') return 'Notion integration token (secret_...)';
  if (id === 'pylon') return 'Pylon API key';
  return 'API key or token';
}

export function ConnectorRow({
  meta,
  status,
  connectedAs,
  allowlist = [],
  lastSyncedAt,
  lastSyncStatus,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showManage, setShowManage] = useState(false);

  const isApiKey = meta.flowType === 'apikey';
  const showApiKeyForm = isApiKey && status === 'disconnected';

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

  return (
    <div className="flex flex-col gap-3 px-5 py-4 transition-colors duration-micro hover:bg-surface-2/40">
      <div className="flex items-start justify-between gap-4">
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
            {status === 'connected' ? (
              <SyncStatusBadge
                provider={meta.id}
                initialLastSyncedAt={lastSyncedAt ?? null}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-text-muted">{meta.description}</p>
          {status === 'connected' && allowlist.length > 0 ? (
            <TooltipProvider delayDuration={150}>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allowlist.map((a) => (
                  <Tooltip key={a.pattern}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center rounded-md border border-accent/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        {a.pattern}
                        {a.isGlob ? <span className="ml-1 opacity-60">*</span> : null}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {a.isGlob ? `Glob: ${a.pattern}` : a.pattern}
                        </span>
                        <span className="text-text-muted">
                          {lastSyncedAt
                            ? `Last synced ${formatRelative(lastSyncedAt)}${
                                lastSyncStatus ? ` · ${lastSyncStatus}` : ''
                              }`
                            : 'Never synced'}
                        </span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          ) : null}
          {error ? <p className="mt-2 text-[12px] text-error">{error}</p> : null}
          {showApiKeyForm ? (
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
            </form>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5">
          {status === 'disconnected' && !isApiKey ? (
            <Button variant="primary" size="sm" onClick={connect} disabled={busy}>
              Connect
            </Button>
          ) : null}
          {status === 'connected' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowManage(true)}
              disabled={busy}
            >
              Manage
            </Button>
          ) : null}
        </div>
      </div>
      {status === 'connected' ? (
        <ConnectorManageSheet
          meta={meta}
          open={showManage}
          onOpenChange={setShowManage}
          connectedAs={connectedAs}
          lastSyncedAt={lastSyncedAt ?? null}
          lastSyncStatus={lastSyncStatus ?? null}
        />
      ) : null}
    </div>
  );
}
