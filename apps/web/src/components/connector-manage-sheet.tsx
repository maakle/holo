'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '@holo/connectors';
import { useConnectorStatus } from '@/lib/connectors-status-store';
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
import { SlackChannelPicker } from '@/components/slack-channel-picker';
import { SyncHistoryPanel } from '@/components/sync-history-panel';
import { SyncedContentPanel } from '@/components/synced-content-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { notifySyncTriggered } from '@/lib/sync-events';
import { openOAuthPopup } from '@/lib/oauth-popup';

interface Props {
  meta: ConnectorMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedAs?: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  /** Number of allowlist entries already saved on the server (GitHub). */
  allowlistCount?: number;
  /** True when the GitHub allowlist is empty — default-all mode. */
  githubDefaultAll?: boolean;
  /** True when the Slack allowlist is empty — default-all mode. */
  slackDefaultAll?: boolean;
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

function formatInterval(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? 'day' : `${days} days`;
  }
  return hours === 1 ? 'hour' : `${hours} hours`;
}

export function ConnectorManageSheet({
  meta,
  open,
  onOpenChange,
  connectedAs,
  lastSyncedAt,
  lastSyncStatus,
  allowlistCount,
  githubDefaultAll,
  slackDefaultAll,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const isApiKey = meta.flowType === 'apikey';
  const isGithub = meta.id === 'github';
  const isSlack = meta.id === 'slack';

  // Live running state comes from the shared bulk-status store — every row,
  // sheet, and badge on the page reads from the same poll loop.
  const status = useConnectorStatus(meta.id);
  const running = status.running;

  async function stopSync() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/stop`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        removed?: number;
        cancelled?: number;
        activeRunning?: number;
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      const removed = body.removed ?? 0;
      const cancelled = body.cancelled ?? 0;
      const active = body.activeRunning ?? 0;
      if (removed === 0 && cancelled === 0) {
        setInfo('Nothing was running.');
      } else {
        const parts: string[] = [];
        if (removed > 0) parts.push(`dropped ${removed} queued`);
        if (cancelled > 0) parts.push(`cancelled ${cancelled} running`);
        const tail =
          active > 0
            ? ' — the worker will exit at the next checkpoint (within seconds).'
            : '.';
        setInfo(`Stopped: ${parts.join(', ')}${tail}`);
        // Force the bulk-status store to repoll immediately so the action bar
        // flips from "Stop sync" → "Sync now" without waiting for the next
        // 3s tick. Same hook used after Sync now / channel-picker save.
        notifySyncTriggered(meta.id);
      }
    } finally {
      setBusy(false);
    }
  }

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
      if (!body.authorizeUrl) {
        setError('unexpected response from initiate');
        return;
      }
      const result = await openOAuthPopup(body.authorizeUrl, meta.id);
      if (result.status === 'error') {
        setError(result.fix ?? `Reconnect failed${result.code ? ` (${result.code})` : ''}`);
        return;
      }
      if (result.status === 'ok') {
        toast.success(`${meta.displayName} reconnected`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
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
      setConfirmingDisconnect(false);
      onOpenChange(false);
      toast.success(`${meta.displayName} disconnected`);
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
          <p className="text-[12px] text-text-muted">
            Syncs automatically every {formatInterval(SYNC_INTERVAL_MS_BY_PROVIDER[meta.id])}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <Button variant="primary" size="sm" onClick={stopSync} disabled={busy}>
                  Stop sync
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={syncNow} disabled={busy}>
                  Sync now
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={reconnect} disabled={busy}>
                {isGithub ? 'Manage installation' : 'Reconnect'}
              </Button>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={busy}
                  className="text-error hover:bg-[color-mix(in_srgb,var(--error)_8%,transparent)]"
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {running ? (
              <div className="flex items-center gap-2 text-[12px] text-text-muted [font-variant-numeric:tabular-nums]">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                <span>Syncing…</span>
                <span>
                  {status.chunksIndexed.toLocaleString()} indexed
                  {status.embedQueued > 0
                    ? ` · ${status.embedQueued.toLocaleString()} queued`
                    : ''}
                </span>
              </div>
            ) : null}

            <AlertDialog open={confirmingDisconnect} onOpenChange={setConfirmingDisconnect}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect {meta.displayName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isGithub
                      ? "The holo App will be uninstalled from GitHub on your behalf, and Holo's local record (installation, repo allowlist, indexed chunks) will be removed. You can re-install anytime from the connections page."
                      : isSlack
                        ? `This revokes your access token. If no other users have Slack connected, the holo app will be fully uninstalled from your workspace — the bot is removed from every channel it joined, and indexed data + the channel allowlist are deleted. You can reconnect anytime.`
                        : `This revokes your access token. If no other users have it connected, indexed data and the allowlist will also be removed.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    destructive
                    disabled={busy}
                    onClick={(e) => {
                      // Prevent Radix's auto-close so the action stays open
                      // until the request completes; we close manually on success.
                      e.preventDefault();
                      void disconnect();
                    }}
                  >
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

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
                <GithubRepoPicker
                  initialSelectedCount={allowlistCount}
                  initialDefaultAll={githubDefaultAll}
                />
              </section>
            ) : null}

            {/* Channels (Slack only) */}
            {isSlack ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[13px] font-medium text-text">Channels</h3>
                  <Badge variant="neutral">slack</Badge>
                </div>
                <p className="text-[12px] text-text-muted">
                  Pick which channels to ingest. The holo bot must be invited to private channels
                  (run <code className="rounded bg-surface-2 px-1">/invite @holo</code> in Slack).
                  Saving triggers an immediate sync.
                </p>
                <SlackChannelPicker
                  initialSelectedCount={allowlistCount}
                  initialDefaultAll={slackDefaultAll}
                />
              </section>
            ) : null}

            {/* Synchronized content — what got indexed and how much. */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-medium text-text">Synchronized content</h3>
                <Badge variant="neutral">snapshot</Badge>
              </div>
              <SyncedContentPanel provider={meta.id} />
            </section>

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
