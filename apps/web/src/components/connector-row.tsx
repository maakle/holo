'use client';
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { ConnectorMeta } from '@/lib/connector-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { GithubRepoPicker } from '@/components/github-repo-picker';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { SyncHistoryPanel } from '@/components/sync-history-panel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { notifySyncTriggered } from '@/lib/sync-events';

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
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showRepos, setShowRepos] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  async function syncNow() {
    setBusy(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/resync`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        queues?: string[];
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      setSyncMessage(`Sync enqueued (${(body.queues ?? []).join(', ') || 'no queues'}).`);
      notifySyncTriggered(meta.id);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = window.confirm(
      `Disconnect ${meta.displayName}? This revokes your access token. ` +
        `If no other users have it connected, indexed data and the repo allowlist will also be removed.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/connection`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const isApiKey = meta.flowType === 'apikey';
  const showForm = isApiKey && (status === 'disconnected' || showApiKeyForm);
  const isGithub = meta.id === 'github';

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
          {syncMessage ? (
            <p className="mt-2 text-[12px] text-text-muted">{syncMessage}</p>
          ) : null}
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5">
          {status === 'connected' && isGithub ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowRepos((v) => !v)}
              disabled={busy}
            >
              {showRepos ? 'Hide repos' : 'Manage repos'}
            </Button>
          ) : null}
          {status === 'disconnected' && !isApiKey ? (
            <Button variant="primary" size="sm" onClick={connect} disabled={busy}>
              Connect
            </Button>
          ) : null}
          {status === 'connected' ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={`${meta.displayName} actions`}
                  disabled={busy}
                >
                  <MoreHorizontal aria-hidden className="h-4 w-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-surface p-1 text-[13px] shadow-md"
                >
                  <DropdownMenu.Item
                    onSelect={() => void syncNow()}
                    className="cursor-pointer rounded-sm px-2 py-1.5 text-text outline-none hover:bg-surface-2 focus:bg-surface-2"
                  >
                    Sync now
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setShowHistory(true)}
                    className="cursor-pointer rounded-sm px-2 py-1.5 text-text outline-none hover:bg-surface-2 focus:bg-surface-2"
                  >
                    Sync history
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => {
                      if (isApiKey) {
                        setShowApiKeyForm(true);
                        setError(null);
                      } else {
                        void connect();
                      }
                    }}
                    className="cursor-pointer rounded-sm px-2 py-1.5 text-text outline-none hover:bg-surface-2 focus:bg-surface-2"
                  >
                    Reconnect
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    onSelect={() => void disconnect()}
                    className="cursor-pointer rounded-sm px-2 py-1.5 text-error outline-none hover:bg-surface-2 focus:bg-surface-2"
                  >
                    Disconnect
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </div>
      </div>
      {isGithub && status === 'connected' && showRepos ? <GithubRepoPicker /> : null}
      {status === 'connected' ? (
        <Sheet open={showHistory} onOpenChange={setShowHistory}>
          <SheetContent side="right" className="w-full sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{meta.displayName} · Sync history</SheetTitle>
              <SheetDescription>
                Recent sync runs from BullMQ, scoped to your organization.
              </SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-5 py-4">
              {showHistory ? <SyncHistoryPanel provider={meta.id} /> : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
