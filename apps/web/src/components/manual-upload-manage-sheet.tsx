'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  sourceToolLabel,
  type ManualUploadSourceTool,
} from '@/lib/manual-upload';
import type { ConnectorMeta } from '@/lib/connector-registry';

interface Session {
  id: string;
  name: string;
  sourceTool: ManualUploadSourceTool;
  chunkProvider: string;
  sessionSlug: string | null;
  uploadedAt: string;
  fileCount: number;
  chunkCount: number;
}

interface Props {
  meta: ConnectorMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function ManualUploadManageSheet({ meta, open, onOpenChange }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/connectors/manual-upload/sessions', {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        sessions?: Session[];
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      setSessions(body.sessions ?? []);
    } catch {
      setError('network error');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function deleteSession(s: Session) {
    setDeletingId(s.id);
    try {
      const res = await fetch(
        `/api/connectors/manual-upload/sessions/${encodeURIComponent(s.id)}`,
        { method: 'DELETE' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        toast.error(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      toast.success(`Deleted "${s.name}"`);
      setConfirmDelete(null);
      await load();
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  function newUpload() {
    onOpenChange(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(`holo:open-wizard:${meta.id}`, {
          detail: { initialStepId: 'name' },
        }),
      );
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              <span>{meta.displayName}</span>
              <Badge variant="success">Connected</Badge>
            </SheetTitle>
            <SheetDescription>
              {sessions === null
                ? 'Loading sessions…'
                : `${sessions.length} upload session${sessions.length === 1 ? '' : 's'}`}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-[0.04em] text-text-subtle">
                  Upload sessions
                </span>
                <Button variant="primary" size="sm" onClick={newUpload}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> New upload
                </Button>
              </div>

              {error ? (
                <div className="rounded-md border border-error/40 bg-[color-mix(in_srgb,var(--error,#dc2626)_8%,transparent)] px-3 py-2 text-[13px] text-text">
                  {error}
                </div>
              ) : null}

              {sessions === null ? (
                <div className="flex items-center gap-2 text-[13px] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading…
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-surface-2/30 px-4 py-6 text-center text-[13px] text-text-muted">
                  No upload sessions yet. Click <span className="text-text">New upload</span>{' '}
                  to drop a folder.
                </div>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-text">
                            {s.name}
                          </span>
                          <Badge variant="neutral">{sourceToolLabel(s.sourceTool)}</Badge>
                        </div>
                        <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                          <dt className="text-text-subtle">Uploaded</dt>
                          <dd className="text-text-muted">{formatRelative(s.uploadedAt)}</dd>
                          <dt className="text-text-subtle">Files</dt>
                          <dd className="font-mono text-text-muted">
                            {s.fileCount.toLocaleString()}
                          </dd>
                          <dt className="text-text-subtle">Chunks</dt>
                          <dd className="font-mono text-text-muted">
                            {s.chunkCount.toLocaleString()}
                          </dd>
                          <dt className="text-text-subtle">Tagged as</dt>
                          <dd className="font-mono text-text-muted">{s.chunkProvider}</dd>
                          {s.sessionSlug ? (
                            <>
                              <dt className="text-text-subtle">Path</dt>
                              <dd className="font-mono text-text-muted truncate">
                                /manual-upload/{s.sessionSlug}/
                              </dd>
                            </>
                          ) : null}
                        </dl>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(s)}
                        disabled={deletingId === s.id}
                        aria-label={`Delete session ${s.name}`}
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-error" aria-hidden />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete upload session?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  This permanently removes <strong>{confirmDelete.name}</strong> —{' '}
                  {confirmDelete.fileCount.toLocaleString()} file
                  {confirmDelete.fileCount === 1 ? '' : 's'} and{' '}
                  {confirmDelete.chunkCount.toLocaleString()} chunk
                  {confirmDelete.chunkCount === 1 ? '' : 's'}. The agent will no longer
                  retrieve them.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteSession(confirmDelete)}
              disabled={deletingId !== null}
              className="bg-error text-white hover:bg-error/90"
            >
              {deletingId ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
