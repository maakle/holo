'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Props {
  provider: string;
  /** ISO timestamp from the server-rendered page; used to detect completion. */
  initialLastSyncedAt: string | null;
}

type Status = { running: boolean; lastSyncedAt: string | null; lastStatus: string | null };

export function SyncStatusBadge({ provider, initialLastSyncedAt }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    running: false,
    lastSyncedAt: initialLastSyncedAt,
    lastStatus: null,
  });
  const wasRunning = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/connectors/${provider}/sync-status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as Status;
        if (cancelled) return;
        setStatus(body);
        // When a sync transitions running → not running, refresh the page so
        // the server-rendered "last synced" tooltip text updates.
        if (wasRunning.current && !body.running) {
          router.refresh();
        }
        wasRunning.current = body.running;
      } finally {
        if (!cancelled) {
          // Poll faster when something is actively running.
          const next = wasRunning.current ? 3000 : 15000;
          timeout = setTimeout(poll, next);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [provider, router]);

  if (!status.running) return null;

  return (
    <Badge variant="neutral" className="gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      Syncing…
    </Badge>
  );
}
