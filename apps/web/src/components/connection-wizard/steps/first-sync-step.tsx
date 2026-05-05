'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
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
  const [running, setRunning] = useState(false);
  const [chunksIndexed, setChunksIndexed] = useState(0);
  const [embedQueued, setEmbedQueued] = useState(0);
  const [latestRun, setLatestRun] = useState<RunRow | null>(null);
  const [activeRun, setActiveRun] = useState<RunRow | null>(null);
  const startedRef = useRef<number>(startedAt ?? Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Notify any sibling badges that we've kicked off a sync (in case the
    // previous step didn't already).
    notifySyncTriggered(meta.id);
    let cancelled = false;
    async function tick() {
      try {
        // Fan out the two reads in parallel — both hit the same DB pool and
        // we want freshness over saving a round-trip. Failures on either side
        // are treated as transient; we'll re-poll in 3s.
        const [statusRes, runsRes] = await Promise.all([
          fetch(`/api/connectors/${meta.id}/sync-status`, { cache: 'no-store' }),
          fetch(`/api/connectors/${meta.id}/runs`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (statusRes.ok) {
          const body = (await statusRes.json()) as {
            running?: boolean;
            chunksIndexed?: number;
            embedQueued?: number;
          };
          setRunning(Boolean(body.running));
          setChunksIndexed(body.chunksIndexed ?? 0);
          setEmbedQueued(body.embedQueued ?? 0);
        }
        if (runsRes.ok) {
          const body = (await runsRes.json()) as { runs?: RunRow[] };
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
  const syncDoneNoIndex =
    !running && !indexedSomething && !failedRun && elapsed > 4000;
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
            <p className="mt-2 text-text-muted">
              Full stack trace and per-file breakdown live under{' '}
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
        <Button variant="primary" onClick={ctx.close}>
          {indexedSomething || syncDoneNoIndex
            ? (args.doneLabel ?? 'Done')
            : 'Close — keep syncing'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
