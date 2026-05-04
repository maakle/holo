'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConnectorMeta } from '@/lib/connector-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { GithubRepoPicker } from '@/components/github-repo-picker';
import { SyncHistoryPanel } from '@/components/sync-history-panel';
import { notifySyncTriggered } from '@/lib/sync-events';

interface Props {
  meta: ConnectorMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedAs?: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  /** Number of allowlist entries already saved on the server (GitHub). */
  allowlistCount?: number;
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

export function ConnectorManageSheet({
  meta,
  open,
  onOpenChange,
  connectedAs,
  lastSyncedAt,
  lastSyncStatus,
  allowlistCount,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isApiKey = meta.flowType === 'apikey';
  const isGithub = meta.id === 'github';

  async function syncNow() {
    setBusy(true);
    setError(null);
    setInfo(null);
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
      setInfo(`Sync enqueued (${(body.queues ?? []).join(', ') || 'no queues'}).`);
      notifySyncTriggered(meta.id);
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // For OAuth providers, restart the OAuth flow. For api-key providers we
      // can't pre-fill the form here — close the sheet and let the user paste
      // a new token in the inline form on the row. Surface a hint instead.
      if (isApiKey) {
        setInfo('Close this panel and paste a fresh token in the row form.');
        return;
      }
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

  async function disconnect() {
    const ok = window.confirm(
      `Disconnect ${meta.displayName}? This revokes your access token. ` +
        `If no other users have it connected, indexed data and the repo allowlist will also be removed.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setInfo(null);
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
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {meta.displayName}
            {connectedAs ? (
              <span className="ml-2 text-text-muted font-normal">· {connectedAs}</span>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {lastSyncedAt
              ? `Last synced ${formatRelative(lastSyncedAt)}${
                  lastSyncStatus ? ` · ${lastSyncStatus}` : ''
                }`
              : 'Never synced'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={syncNow} disabled={busy}>
                Sync now
              </Button>
              <Button variant="secondary" size="sm" onClick={reconnect} disabled={busy}>
                Reconnect
              </Button>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={disconnect}
                  disabled={busy}
                  className="text-error hover:bg-[color-mix(in_srgb,var(--error)_8%,transparent)]"
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-error/30 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] px-3 py-2 text-[12px] text-error">
                {error}
              </div>
            ) : null}
            {info ? (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
                {info}
              </div>
            ) : null}

            {/* Repos (GitHub only) */}
            {isGithub ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[13px] font-medium text-text">Repos</h3>
                  <Badge variant="neutral">github</Badge>
                </div>
                <p className="text-[12px] text-text-muted">
                  Pick which repositories to ingest. Saving triggers an immediate sync.
                </p>
                <GithubRepoPicker initialSelectedCount={allowlistCount} />
              </section>
            ) : null}

            {/* Sync history */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-medium text-text">Sync history</h3>
                <Badge variant="neutral">last ~20 runs</Badge>
              </div>
              <SyncHistoryPanel provider={meta.id} />
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
