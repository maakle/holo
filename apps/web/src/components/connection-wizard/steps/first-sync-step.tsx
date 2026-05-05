'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import type { WizardContext } from '../types';

interface Args {
  /** Optional override for the closing CTA. Default: "Done". */
  doneLabel?: string;
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
  const startedRef = useRef<number>(startedAt ?? Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Notify any sibling badges that we've kicked off a sync (in case the
    // previous step didn't already).
    notifySyncTriggered(meta.id);
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/connectors/${meta.id}/sync-status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { running?: boolean; chunksIndexed?: number };
        if (cancelled) return;
        setRunning(Boolean(body.running));
        setChunksIndexed(body.chunksIndexed ?? 0);
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
  const syncDoneNoIndex = !running && !indexedSomething && elapsed > 4000;

  return (
    <>
      <div className="flex flex-col gap-3">
        {indexedSomething ? (
          <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" aria-hidden />
              <span className="font-medium">Indexing started</span>
            </div>
            <p className="mt-1 text-text-muted">
              {chunksIndexed.toLocaleString()} chunk{chunksIndexed === 1 ? '' : 's'} indexed
              so far. Sync continues in the background — you can close this dialog and check
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
          <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>
              Sync running…
              {chunksIndexed > 0 ? ` ${chunksIndexed} chunks indexed` : ` pulling from ${meta.displayName}`}
            </span>
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
