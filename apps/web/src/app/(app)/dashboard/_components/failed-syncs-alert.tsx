import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';
import { loadLatestSyncStatusByProvider } from '@/lib/sync-status';
import { CONNECTORS } from '@/lib/connector-registry';

export async function FailedSyncsAlert({ orgId }: { orgId: string }) {
  const { db } = await getServerContext();
  const latestByProvider = await loadLatestSyncStatusByProvider(db, orgId);

  const failed = [...latestByProvider.values()].filter((r) => r.status === 'failed');
  if (failed.length === 0) return null;

  const displayNameByProvider = new Map(
    CONNECTORS.map((c) => [c.id as string, c.displayName]),
  );
  const names = failed
    .map((r) => displayNameByProvider.get(r.provider) ?? r.provider)
    .sort();

  return (
    <Link
      href="/connections"
      className="group flex items-start gap-3 rounded-md border border-error/30 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-4 transition-colors hover:border-error/50"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-error">
          {failed.length === 1
            ? `${names[0]} sync failed`
            : `${failed.length} connectors have sync failures`}
        </div>
        {failed.length > 1 ? (
          <div className="mt-0.5 text-[12px] text-error/80">{names.join(', ')}</div>
        ) : null}
        <div className="mt-1 text-[12px] text-error/70">
          Open Connections to view the error and retry.
        </div>
      </div>
      <ArrowUpRight
        className="mt-0.5 h-4 w-4 shrink-0 text-error/70 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

export function FailedSyncsAlertSkeleton() {
  return null;
}
