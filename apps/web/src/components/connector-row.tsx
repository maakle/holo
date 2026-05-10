'use client';
import { useEffect, useState } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { ConnectorManageSheet } from '@/components/connector-manage-sheet';
import { ConnectionWizard } from '@/components/connection-wizard/connection-wizard';
import { getWizardConfig } from '@/components/connection-wizard/configs';
import { ConnectorLogo } from '@/components/connector-logo';

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

export function ConnectorRow({
  meta,
  status,
  connectedAs,
  allowlist = [],
  lastSyncedAt,
  lastSyncStatus,
}: Props) {
  const [showManage, setShowManage] = useState(false);
  // Persist wizard open-state + current step to sessionStorage so the wizard
  // survives any page reload (notably: next dev's Fast Refresh hard-reload
  // when the OAuth popup hits new routes that get lazy-compiled).
  const wizardOpenKey = `holo:wizard-open:${meta.id}`;
  const wizardStepKey = `holo:wizard-step:${meta.id}`;
  const [wizardOpen, setWizardOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(wizardOpenKey) === '1';
  });
  const [wizardInitialStepId, setWizardInitialStepIdState] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    return sessionStorage.getItem(wizardStepKey) ?? undefined;
  });
  const config = getWizardConfig(meta.id);
  const connected = status === 'connected';
  const comingSoon = !meta.implemented;

  function setWizardOpen(open: boolean) {
    setWizardOpenState(open);
    if (typeof window !== 'undefined') {
      if (open) sessionStorage.setItem(wizardOpenKey, '1');
      else {
        sessionStorage.removeItem(wizardOpenKey);
        sessionStorage.removeItem(wizardStepKey);
      }
    }
  }

  function setWizardInitialStepId(id: string | undefined) {
    setWizardInitialStepIdState(id);
    if (typeof window !== 'undefined') {
      if (id) sessionStorage.setItem(wizardStepKey, id);
      else sessionStorage.removeItem(wizardStepKey);
    }
  }

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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md text-text-muted">
          <ConnectorLogo id={meta.id} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-text">{meta.displayName}</span>
            {comingSoon ? (
              <Badge variant="neutral">Coming soon</Badge>
            ) : connected ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="neutral">Not connected</Badge>
            )}
            {!comingSoon && connected ? (
              <SyncStatusBadge provider={meta.id} initialLastSyncedAt={lastSyncedAt ?? null} />
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-text-muted">{meta.description}</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5">
          {comingSoon ? null : !connected ? (
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
      {!comingSoon && connected ? (
        <ConnectorManageSheet
          meta={meta}
          open={showManage}
          onOpenChange={setShowManage}
          connectedAs={connectedAs}
          lastSyncedAt={lastSyncedAt ?? null}
          lastSyncStatus={lastSyncStatus ?? null}
          allowlist={allowlist}
          allowlistCount={allowlist.length}
          githubDefaultAll={meta.id === 'github' && allowlist.length === 0}
          slackDefaultAll={meta.id === 'slack' && allowlist.length === 0}
        />
      ) : null}
      {!comingSoon && config ? (
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
      ) : null}
    </div>
  );
}
