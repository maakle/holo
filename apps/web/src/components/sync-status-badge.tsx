'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  useConnectorStatus,
  useOnSyncCompleted,
} from '@/lib/connectors-status-store';

interface Props {
  provider: string;
  /** Reserved for SSR parity; the live store overrides once it has data. */
  initialLastSyncedAt?: string | null;
}

export function SyncStatusBadge({ provider }: Props) {
  const router = useRouter();
  const status = useConnectorStatus(provider);
  const refresh = useCallback(() => router.refresh(), [router]);
  useOnSyncCompleted(provider, refresh);

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
