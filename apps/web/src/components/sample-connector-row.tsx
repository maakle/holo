'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  installed: boolean;
  artifactCount: number;
}

/**
 * Sits at the top of the connections list. Always visible — every workspace
 * either has the sample dataset (with a Remove button) or can install it
 * with a single click.
 */
export function SampleConnectorRow({ installed, artifactCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'install' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function install() {
    setBusy('install');
    setError(null);
    try {
      const res = await fetch('/api/sample-data', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { problem?: string };
        setError(data.problem ?? 'Could not install sample data.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error.');
    } finally {
      setBusy(null);
    }
  }

  async function confirmRemove() {
    setBusy('remove');
    setError(null);
    try {
      const res = await fetch('/api/sample-data', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { problem?: string };
        setError(data.problem ?? 'Could not remove sample data.');
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError('Network error.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="sample" className="flex flex-col gap-3 scroll-mt-6">
      <span className="caption text-text-subtle">Sample data</span>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-text">
                  Star Wars Archive
                </span>
                {installed ? (
                  <Badge variant="success">
                    Installed{artifactCount ? ` · ${artifactCount} items` : ''}
                  </Badge>
                ) : (
                  <Badge variant="neutral">Not installed</Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-text-muted">
                Curated docs, channel messages, and issues so your agent has real-shaped
                context to query while you set up your first connector. Every new
                workspace gets this by default — remove it any time.
              </p>
              {error ? (
                <p className="mt-2 text-[12px] text-error">{error}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5">
              {installed ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy !== null}
                >
                  Remove
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={install}
                  disabled={busy !== null}
                >
                  {busy === 'install' ? 'Installing…' : 'Install'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove sample data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the Star Wars sample artifacts and their
              indexed chunks for this workspace. Real connector data is not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'remove'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={busy === 'remove'}
            >
              {busy === 'remove' ? 'Removing…' : 'Remove sample data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
