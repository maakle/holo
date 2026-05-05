'use client';
import { useEffect, useState } from 'react';
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
import { ConnectionWizard } from '@/components/connection-wizard/connection-wizard';
import { getWizardConfig } from '@/components/connection-wizard/configs';

interface AllowlistEntry {
  pattern: string;
  isGlob: boolean;
  /** Human-readable label (e.g. channel name for slack). When null we fall
   * back to rendering the raw pattern. Older rows from before notes-on-write
   * was added will have label === null. */
  label: string | null;
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

export function ConnectorRow({
  meta,
  status,
  connectedAs,
  allowlist = [],
  lastSyncedAt,
  lastSyncStatus,
}: Props) {
  const [showManage, setShowManage] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialStepId, setWizardInitialStepId] = useState<string | undefined>(undefined);
  const config = getWizardConfig(meta.id);
  const connected = status === 'connected';

  // Listen for page-level requests to open this provider's wizard at a
  // specific step (e.g. Slack's soft heuristic firing post-load when the
  // allowlist is empty). Detail: { initialStepId?: string }.
  useEffect(() => {
    const eventName = `holo:open-wizard:${meta.id}`;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ initialStepId?: string }>).detail;
      setWizardInitialStepId(detail?.initialStepId);
      setWizardOpen(true);
    };
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [meta.id]);

  function connect() {
    setWizardInitialStepId(undefined);
    setWizardOpen(true);
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-4 transition-colors duration-micro hover:bg-surface-2/40">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-text">{meta.displayName}</span>
            {connected ? (
              <Badge variant="success">
                Connected{connectedAs ? ` · ${connectedAs}` : ''}
              </Badge>
            ) : (
              <Badge variant="neutral">Not connected</Badge>
            )}
            {connected ? (
              <SyncStatusBadge
                provider={meta.id}
                initialLastSyncedAt={lastSyncedAt ?? null}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-text-muted">{meta.description}</p>
          {connected && allowlist.length > 0 ? (
            <TooltipProvider delayDuration={150}>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allowlist.map((a) => {
                  const display =
                    a.label != null
                      ? meta.id === 'slack'
                        ? `#${a.label}`
                        : a.label
                      : a.pattern;
                  return (
                    <Tooltip key={a.pattern}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-default items-center rounded-md border border-accent/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-accent">
                          {display}
                          {a.isGlob ? <span className="ml-1 opacity-60">*</span> : null}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {a.isGlob ? `Glob: ${a.pattern}` : display}
                          </span>
                          {a.label != null ? (
                            <span className="font-mono text-[10px] text-text-muted">
                              {a.pattern}
                            </span>
                          ) : null}
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
                  );
                })}
              </div>
            </TooltipProvider>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5">
          {!connected ? (
            <Button variant="primary" size="sm" onClick={connect}>
              Connect
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setShowManage(true)}>
              Manage
            </Button>
          )}
        </div>
      </div>
      {connected ? (
        <ConnectorManageSheet
          meta={meta}
          open={showManage}
          onOpenChange={setShowManage}
          connectedAs={connectedAs}
          lastSyncedAt={lastSyncedAt ?? null}
          lastSyncStatus={lastSyncStatus ?? null}
          allowlistCount={allowlist.length}
          githubDefaultAll={meta.id === 'github' && allowlist.length === 0}
          slackDefaultAll={meta.id === 'slack' && allowlist.length === 0}
        />
      ) : null}
      <ConnectionWizard
        meta={meta}
        config={config}
        open={wizardOpen}
        onOpenChange={(next) => {
          setWizardOpen(next);
          if (!next) setWizardInitialStepId(undefined);
        }}
        connected={connected}
        connectedAs={connectedAs}
        initialStepId={wizardInitialStepId}
      />
    </div>
  );
}
