'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import { useConnectorStatus } from '@/lib/connectors-status-store';
import type { WizardContext } from '../types';

interface Args {
  /** Optional override for the closing CTA. Default: "Done". */
  doneLabel?: string;
}

type RunRow = {
  id: string;
  queue: string;
  state: 'completed' | 'failed' | 'stalled' | 'cancelled' | 'active' | 'waiting' | 'delayed';
  durationMs: number | null;
  artifactCount: number | null;
  failedReason: string | null;
  failedCause: string | null;
  failedCode: string | null;
  failedFix: string | null;
  finishedOn: number | null;
  processedOn: number | null;
  liveArtifactCount: number | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  progressMessage: string | null;
};

// Map a BullMQ queue name to a user-friendly stage label. Queue suffixes are
// stable: `<provider>-sync` for the discovery/fetch phase, `embed` for the
// embedding worker. Anything else falls back to the raw queue name so we
// never silently swallow a new pipeline stage.
function stageLabel(queue: string): string {
  if (queue === 'embed') return 'Generating embeddings';
  if (queue.endsWith('-sync')) return 'Pulling content from source';
  return queue;
}

/**
 * Generic "watch the first sync" step. Polls /sync-status, surfaces
 * `chunksIndexed` so the user sees actual progress, and lets them close at
 * any time — sync continues in the background.
 *
 * Shared state shape (read by this step, written elsewhere or seeded fresh):
 *   syncStartedAt?: number — epoch ms; if absent, we record one on mount.
 */
export function firstSyncStep<TState>(
  ctx: WizardContext<TState>,
  args: Args = {},
) {
  return <FirstSyncStep ctx={ctx} args={args} />;
}

function FirstSyncStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta } = ctx;
  const startedAt =
    (ctx.state as { syncStartedAt?: number }).syncStartedAt ?? null;
  // Status (running / chunksIndexed / embedQueued) flows from the shared
  // bulk-status store — every connector on the page reads from one polling
  // loop. The /runs endpoint stays per-provider since the wizard cares about
  // individual job progress.
  const status = useConnectorStatus(meta.id);
  const running = status.running;
  const chunksIndexed = status.chunksIndexed;
  const embedQueued = status.embedQueued;
  const [latestRun, setLatestRun] = useState<RunRow | null>(null);
  const [activeRun, setActiveRun] = useState<RunRow | null>(null);
  const [stopping, setStopping] = useState(false);
  const startedRef = useRef<number>(startedAt ?? Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function stopSync() {
    setStopping(true);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/stop`, {
        method: 'POST',
      });
      if (res.ok) {
        toast.success('Sync stopped');
        // Reset the dialog-local timer so when the user re-runs the sync
        // (or backs up to fix the credential step) the elapsed counter
        // doesn't carry over.
        startedRef.current = Date.now();
        ctx.refreshServer();
      } else {
        const body = (await res.json().catch(() => ({}))) as { fix?: string };
        toast.error(body.fix ?? 'Could not stop sync');
      }
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    notifySyncTriggered(meta.id);
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/connectors/${meta.id}/runs`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { runs?: RunRow[] };
          const runs = body.runs ?? [];
          setLatestRun(runs[0] ?? null);
          setActiveRun(
            runs.find((r) => r.state === 'active' || r.state === 'waiting') ?? null,
          );
        }
      } finally {
        if (!cancelled) timerRef.current = setTimeout(tick, 3000);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [meta.id]);

  const indexedSomething = chunksIndexed > 0;
  const elapsed = Date.now() - startedRef.current;
  const failedRun = latestRun?.state === 'failed' ? latestRun : null;
  // Only declare "no new content" once the latest run has actually completed.
  // The previous heuristic (elapsed > 4s + chunksIndexed=0) misfires before
  // the worker picks the job up — or whenever /status hasn't refreshed yet
  // — and is what made fresh connects flash "Sync finished — no new content"
  // while the worker was still indexing.
  const completedRun =
    latestRun?.state === 'completed' ? latestRun : null;
  const syncDoneNoIndex =
    !running &&
    !indexedSomething &&
    !failedRun &&
    completedRun !== null &&
    (completedRun.artifactCount ?? 0) === 0 &&
    (completedRun.liveArtifactCount ?? 0) === 0;
  // Prefer the connector's own heartbeat over the queue label — "Indexing
  // page 12 of 47" is more useful than "Pulling content from source".
  const stage =
    activeRun?.progressMessage ??
    (activeRun ? stageLabel(activeRun.queue) : null);
  const progressFraction =
    activeRun &&
    typeof activeRun.progressCurrent === 'number' &&
    typeof activeRun.progressTotal === 'number' &&
    activeRun.progressTotal > 0
      ? `${activeRun.progressCurrent} / ${activeRun.progressTotal}`
      : null;
  // While running, the worker hasn't written artifact_count yet — fall back
  // to the live count that the runs API computes from chunks.created_at.
  const liveChunks =
    chunksIndexed > 0 ? chunksIndexed : (activeRun?.liveArtifactCount ?? 0);

  return (
    <>
      <div className="flex flex-col gap-3">
        {failedRun ? (
          <div className="rounded-md border border-error/40 bg-[color-mix(in_srgb,var(--error,#dc2626)_8%,transparent)] px-3 py-2 text-[13px] text-text">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-error" aria-hidden />
              <span className="font-medium">Sync failed</span>
            </div>
            {failedRun.failedReason ? (
              <p className="mt-1 wrap-break-word font-mono text-[12px] text-text-muted">
                {failedRun.failedReason}
              </p>
            ) : null}
            {failedRun.failedCause ? (
              <p className="mt-2 wrap-break-word text-[12px] text-text-muted">
                {failedRun.failedCause}
              </p>
            ) : null}
            {failedRun.failedFix ? (
              <p className="mt-2 wrap-break-word text-[12px] text-text">
                <span className="font-medium">Fix:</span> {failedRun.failedFix}
              </p>
            ) : null}
            <p className="mt-2 text-text-muted">
              Full history and per-file breakdown live under{' '}
              <span className="font-medium text-text">Manage</span> → Sync history.
            </p>
          </div>
        ) : indexedSomething ? (
          <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" aria-hidden />
              <span className="font-medium">Indexing started</span>
            </div>
            <p className="mt-1 text-text-muted">
              {chunksIndexed.toLocaleString()} chunk{chunksIndexed === 1 ? '' : 's'} indexed
              {embedQueued > 0
                ? `, ${embedQueued.toLocaleString()} more queued for embedding`
                : ''}
              . Sync continues in the background — you can close this dialog and check
              progress under <span className="font-medium text-text">Manage</span>.
            </p>
          </div>
        ) : syncDoneNoIndex ? (
          <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[13px] text-text">
            <div className="font-medium">Sync finished — no new content</div>
            <p className="mt-1 text-text-muted">
              No new content was found yet. Future updates will be picked up on the next
              scheduled sync.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span className="text-text">
                {stage ?? `Connecting to ${meta.displayName}…`}
              </span>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              <dt className="text-text-subtle">Queue</dt>
              <dd className="font-mono text-text-muted">
                {activeRun?.queue ?? 'queued'}
              </dd>
              {progressFraction ? (
                <>
                  <dt className="text-text-subtle">Progress</dt>
                  <dd className="font-mono text-text-muted">{progressFraction}</dd>
                </>
              ) : null}
              <dt className="text-text-subtle">Chunks indexed</dt>
              <dd className="font-mono text-text-muted">
                {liveChunks.toLocaleString()}
              </dd>
              <dt className="text-text-subtle">In embed queue</dt>
              <dd className="font-mono text-text-muted">
                {embedQueued.toLocaleString()}
              </dd>
              <dt className="text-text-subtle">Elapsed</dt>
              <dd className="font-mono text-text-muted">
                {Math.max(1, Math.round(elapsed / 1000))}s
              </dd>
            </dl>
          </div>
        )}
        <p className="text-[12px] text-text-subtle">
          Sync runs in the background even when this dialog is closed. Progress is visible
          under <span className="font-medium text-text">Manage</span> on the row.
        </p>
      </div>
      <AlertDialogFooter>
        {/* Back is always available — lets users step back to the credential
            step to fix mistakes (wrong scopes, wrong impersonation email)
            without abandoning the wizard. */}
        <Button variant="ghost" onClick={ctx.goPrev}>
          Back
        </Button>
        {/* Stop appears only while the sync is actively running. Cancels the
            queued/in-flight job server-side so the user can fix config and
            retry without waiting for it to fail or complete. */}
        {(running || activeRun) && !failedRun ? (
          <Button
            variant="secondary"
            onClick={stopSync}
            disabled={stopping}
          >
            {stopping ? 'Stopping…' : 'Stop sync'}
          </Button>
        ) : null}
        <Button variant="primary" onClick={ctx.close}>
          {failedRun
            ? 'Close'
            : indexedSomething || syncDoneNoIndex
              ? (args.doneLabel ?? 'Done')
              : 'Close — keep syncing'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
