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

  return (
    <Badge variant="neutral" className="gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      Syncing…
    </Badge>
  );
}
