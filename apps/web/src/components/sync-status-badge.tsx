'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { onSyncTriggered } from '@/lib/sync-events';

interface Props {
  provider: string;
  /** ISO timestamp from the server-rendered page; used to detect completion. */
  initialLastSyncedAt: string | null;
}

type Status = {
  running: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  embedQueued: number;
  chunksIndexed: number;
};

const POLL_INTERVAL_MS = 3000;

export function SyncStatusBadge({ provider, initialLastSyncedAt }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    running: false,
    lastSyncedAt: initialLastSyncedAt,
    lastStatus: null,
    embedQueued: 0,
    chunksIndexed: 0,
  });
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingRef = useRef(false);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function tick(): Promise<void> {
      try {
        const res = await fetch(`/api/connectors/${provider}/sync-status`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          // Stop on error rather than spinning indefinitely; user action will restart.
          pollingRef.current = false;
          return;
        }
        const body = (await res.json()) as Status;
        if (cancelledRef.current) return;
        setStatus(body);
        // running → idle: refresh server-rendered tooltip data, then stop.
        if (wasRunningRef.current && !body.running) {
          router.refresh();
        }
        wasRunningRef.current = body.running;
        if (!body.running) {
          pollingRef.current = false;
          return;
        }
      } catch {
        pollingRef.current = false;
        return;
      }
      timeoutRef.current = setTimeout(() => {
        if (!cancelledRef.current) void tick();
      }, POLL_INTERVAL_MS);
    }

    function startPolling(): void {
      if (pollingRef.current) return;
      pollingRef.current = true;
      void tick();
    }

    // First load: one fetch. If running, keep polling until it transitions to idle.
    startPolling();

    // Resume polling whenever the user kicks off a sync from elsewhere on the page
    // (Sync now button, Save selection in the repo picker, etc).
    const off = onSyncTriggered(provider, startPolling);

    return () => {
      cancelledRef.current = true;
      off();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      pollingRef.current = false;
    };
  }, [provider, router]);

  if (!status.running) return null;

  const counter =
    status.embedQueued > 0
      ? `${status.chunksIndexed.toLocaleString()} indexed · ${status.embedQueued.toLocaleString()} queued`
      : `${status.chunksIndexed.toLocaleString()} indexed`;

  return (
    <Badge variant="neutral" className="gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      Syncing… <span className="text-text-muted/80">{counter}</span>
    </Badge>
  );
}
