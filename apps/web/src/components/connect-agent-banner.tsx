'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Database } from 'lucide-react';
import { useAllConnectorsStatus } from '@/lib/connectors-status-store';
import { notifySampleDataChanged } from '@/lib/sample-data-events';

export type ConnectAgentBannerInitial = {
  /** Real (non-sample) connector currently active for the org. */
  hasRealConnector: boolean;
  /** Total chunks indexed across real (non-sample) connectors. */
  realChunksIndexed: number;
  /** Star Wars sample data installed for the org. */
  sampleActive: boolean;
};

interface Props {
  initial: ConnectAgentBannerInitial;
}

/**
 * Status banner shown above the MCP setup steps. Three mutually exclusive states:
 *   1. Real connector(s) connected, but still syncing or no data yet.
 *   2. No real connector and no sample data — offer one-click sample install.
 *   3. Sample data installed but no real connector — gentle reminder.
 *
 * The banner stays out of the way once the workspace has real, populated data.
 *
 * `initial` is rendered server-side so the banner doesn't flash; the live
 * status store updates `running` / `chunksIndexed` once the client polls.
 */
export function ConnectAgentBanner({ initial }: Props) {
  const router = useRouter();
  const statuses = useAllConnectorsStatus();

  const liveAnyRunning = useMemo(
    () => Object.values(statuses).some((s) => s.running),
    [statuses],
  );
  const liveChunksTotal = useMemo(
    () => Object.values(statuses).reduce((acc, s) => acc + (s.chunksIndexed ?? 0), 0),
    [statuses],
  );

  // Prefer live data once we have a poll back from /api/connectors/status, but
  // fall back to the SSR snapshot until then.
  const haveLiveData = Object.keys(statuses).length > 0;
  const chunksIndexed = haveLiveData ? liveChunksTotal : initial.realChunksIndexed;
  const anyRunning = haveLiveData ? liveAnyRunning : false;

  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  async function installSample() {
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch('/api/sample-data', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { problem?: string };
        setInstallError(data.problem ?? 'Could not install sample data.');
        return;
      }
      notifySampleDataChanged(true);
      router.refresh();
    } catch {
      setInstallError('Network error.');
    } finally {
      setInstalling(false);
    }
  }

  // State 1: a real connector is connected but the index is still warming up.
  if (initial.hasRealConnector && (anyRunning || chunksIndexed === 0)) {
    return (
      <div className="rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-4 text-[13px]">
        <div className="flex items-start gap-3">
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning"
            aria-hidden
          />
          <div className="space-y-1">
            <div className="font-medium text-text">
              Initial sync in progress — your agent will see partial results until
              indexing completes.
            </div>
            <div className="text-text-muted">
              Depending on how much data we need to index, the first sync can take
              several hours. You can wire up an agent now and re-query as more
              context becomes available.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // State 2: nothing connected, nothing seeded — offer the sample.
  if (!initial.hasRealConnector && !initial.sampleActive) {
    return (
      <div className="rounded-md border border-accent/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-4 text-[13px]">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <div className="flex-1 space-y-2">
            <div className="space-y-1">
              <div className="font-medium text-text">
                No connections yet — try a sample workspace
              </div>
              <div className="text-text-muted">
                Install the Star Wars sample dataset (a handful of docs, channel
                messages, and issues) so your agent has real-shaped context to
                query while you set up your first connector.
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={installSample}
                disabled={installing}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-opacity duration-micro hover:opacity-90 disabled:opacity-50"
              >
                {installing ? 'Installing…' : 'Install sample data'}
              </button>
              <a
                href="/connections"
                className="text-[12px] text-text-muted hover:text-text"
              >
                Or connect a real tool →
              </a>
            </div>
            {installError ? (
              <div className="pt-1 text-[12px] text-error">{installError}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // State 3: sample-only — gently remind that real connections will replace it.
  if (!initial.hasRealConnector && initial.sampleActive) {
    return (
      <div className="rounded-md border border-border bg-surface-2 p-4 text-[13px]">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <div className="space-y-1">
            <div className="font-medium text-text">
              You&apos;re querying sample data
            </div>
            <div className="text-text-muted">
              Your agent will see the Star Wars sample dataset until you connect
              a real tool.{' '}
              <a href="/connections" className="text-accent hover:underline">
                Connect a tool →
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
