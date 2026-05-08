'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactCount: number;
  installedAt: string | null;
  kindBreakdown: Array<{ kind: string; count: number }>;
}

const KIND_LABELS: Record<string, { singular: string; plural: string }> = {
  doc: { singular: 'doc', plural: 'docs' },
  message: { singular: 'channel message', plural: 'channel messages' },
  issue: { singular: 'issue', plural: 'issues' },
};

function labelFor(kind: string, count: number): string {
  const m = KIND_LABELS[kind];
  if (!m) return kind;
  return count === 1 ? m.singular : m.plural;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export function SampleManageSheet({
  open,
  onOpenChange,
  artifactCount,
  installedAt,
  kindBreakdown,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sample-data', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { problem?: string };
        setError(data.problem ?? 'Could not remove sample data.');
        return;
      }
      setConfirmOpen(false);
      onOpenChange(false);
      router.refresh();
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  }

  const total = kindBreakdown.reduce((acc, k) => acc + k.count, 0);
  const showTable = kindBreakdown.length >= 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            Star Wars Archive
            <span className="ml-2 text-text-muted font-normal">· Sample data</span>
          </SheetTitle>
          <SheetDescription>
            {installedAt
              ? `Installed ${formatRelative(installedAt)} · curated, never re-syncs`
              : 'Curated, never re-syncs'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {/* Action bar — mirrors the connector sheet but sample only has Remove. */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Installed ·{' '}
                {fmt(artifactCount)} items
              </Badge>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy}
                  className="text-error hover:bg-[color-mix(in_srgb,var(--error)_8%,transparent)]"
                >
                  Remove
                </Button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-error/30 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] px-3 py-2 text-[12px] text-error">
                {error}
              </div>
            ) : null}

            {/* About — sample data has no OAuth/API key/allowlist sections, so
                the equivalent slot is a one-paragraph "why is this here?". */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-medium text-text">About</h3>
                <Badge variant="neutral">sample</Badge>
              </div>
              <p className="text-[12px] leading-5 text-text-muted">
                Curated docs, channel messages, and issues so your agent has
                real-shaped context to query while you set up your first
                connector. Every new workspace gets this by default — remove
                it any time. Real connector data is not affected.
              </p>
            </section>

            {/* Synchronized content — same visual structure as the connector
                sheet's panel; rendered inline because /stats is gated to
                SYNC_PROVIDERS and the sample dataset is static. */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-medium text-text">Synchronized content</h3>
                <Badge variant="neutral">snapshot</Badge>
              </div>
              {kindBreakdown.length === 0 ? (
                <div className="rounded-md border border-border bg-bg px-3 py-3 text-[12px] text-text-muted">
                  Nothing installed.
                </div>
              ) : !showTable ? (
                <div className="rounded-md border border-border bg-bg px-4 py-3 [font-variant-numeric:tabular-nums]">
                  <div className="text-[13px] text-text">
                    <span className="font-medium">{fmt(kindBreakdown[0]!.count)}</span>{' '}
                    <span>{labelFor(kindBreakdown[0]!.kind, kindBreakdown[0]!.count)}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-bg [font-variant-numeric:tabular-nums]">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                          Kind
                        </th>
                        <th className="px-4 py-2.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                          Items
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {kindBreakdown.map((k) => (
                        <tr key={k.kind} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2.5 text-[13px] text-text">
                            {labelFor(k.kind, k.count)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[13px] text-text">
                            {fmt(k.count)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-surface-2">
                        <td className="px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-text-muted">
                          Total
                        </td>
                        <td className="px-4 py-2.5 text-right text-[13px] font-medium text-text">
                          {fmt(total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Sync history — sample data is static. We keep the same section
                so the surface lines up with the connector sheet, but state
                that there's no recurring sync. */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-medium text-text">Sync history</h3>
                <Badge variant="neutral">static</Badge>
              </div>
              <div className="rounded-md border border-border bg-bg px-3 py-3 text-[12px] text-text-muted">
                Sample data is curated and installed once. There are no
                recurring sync runs — nothing to schedule, nothing to retry.
              </div>
            </section>
          </div>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove sample data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the Star Wars sample artifacts and
                their indexed chunks for this workspace. Real connector data is
                not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                destructive
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  void confirmRemove();
                }}
              >
                {busy ? 'Removing…' : 'Remove sample data'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
