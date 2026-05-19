'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { shouldIndexByPath } from '@holo/connectors/github/code-skip';
import {
  MANUAL_UPLOAD_MAX_FILE_BYTES,
  MANUAL_UPLOAD_SOURCE_TOOLS,
  sourceToolLabel,
  type ManualUploadSourceTool,
} from '@/lib/manual-upload';
import type { WizardContext } from '../types';

export interface ManualUploadState {
  /** Persisted session id once the API call has succeeded. Null before. */
  sessionId: string | null;
  /** Display name the user typed in step 1. */
  sessionName: string;
  /** Source tool the user picked in step 1. */
  sourceTool: ManualUploadSourceTool;
}

export const manualUploadInitialState: ManualUploadState = {
  sessionId: null,
  sessionName: '',
  sourceTool: 'other',
};

// --- Step 1: name + source-tool ---------------------------------------------

export function manualUploadNameStep(ctx: WizardContext<ManualUploadState>) {
  return <NameStep ctx={ctx} />;
}

function NameStep({ ctx }: { ctx: WizardContext<ManualUploadState> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = ctx.state.sessionName;
  const tool = ctx.state.sourceTool;

  // Persist step state on every mutation so a Fast Refresh / accidental
  // close-reopen doesn't drop the typed values.
  function setName(v: string) {
    ctx.setState({ sessionName: v });
    if (error) setError(null);
  }
  function setTool(v: ManualUploadSourceTool) {
    ctx.setState({ sourceTool: v });
  }

  async function createSession() {
    if (!name.trim()) {
      setError('Give this upload a short name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/manual-upload/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), source_tool: tool }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        fix?: string;
        problem?: string;
      };
      if (!res.ok || !body.sessionId) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      ctx.setState({ sessionId: body.sessionId });
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-text-muted">
          Drop a folder — markdown exports, source code, configs, or docs.
          Holo chunks, embeds, and tags everything; code files get the
          code-tuned embedding model. <code className="font-mono text-[12px]">node_modules</code>,
          {' '}<code className="font-mono text-[12px]">.git</code>, build output, lockfiles,
          and binaries are skipped automatically.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[0.04em] text-text-subtle">
            Upload name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="grain-export-2026-05"
            disabled={busy}
            className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
            autoComplete="off"
          />
          <span className="text-[12px] text-text-subtle">
            Appears in the file explorer at{' '}
            <code className="font-mono">/manual-upload/&lt;name&gt;/...</code>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[0.04em] text-text-subtle">
            Source tool
          </span>
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as ManualUploadSourceTool)}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text focus:outline-hidden focus:focus-ring"
          >
            {/* Real connectors A→Z, then "Other" pinned to the bottom as the
                opt-out tag. Sort by label (not id) so "Google Drive" lands
                under G, not "googledrive". */}
            {MANUAL_UPLOAD_SOURCE_TOOLS.filter((t) => t !== 'other')
              .map((t) => ({ id: t, label: sourceToolLabel(t) }))
              .sort((a, b) => a.label.localeCompare(b.label))
              .map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            <option value="other">Other</option>
          </select>
          <span className="text-[12px] text-text-subtle">
            When set to a real connector, the agent sees these files as if they came from
            it. &quot;Other&quot; tags them as <code className="font-mono">manual-upload</code>.
          </span>
        </label>
        {error ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>
      <AlertDialogFooter>
        <Button variant="secondary" onClick={ctx.close} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={createSession} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Continue'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

// --- Step 2: folder picker + progress ---------------------------------------

interface FileEntry {
  // Stable client-side id (path + size + lastModified) for the React list.
  key: string;
  file: File;
  relPath: string;
  state: 'queued' | 'uploading' | 'indexed' | 'failed' | 'skipped';
  chunkCount: number;
  error?: string;
}

const UPLOAD_CONCURRENCY = 4;

export function manualUploadStep(ctx: WizardContext<ManualUploadState>) {
  return <UploadStep ctx={ctx} />;
}

function UploadStep({ ctx }: { ctx: WizardContext<ManualUploadState> }) {
  const sessionId = ctx.state.sessionId;
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Single global upload-pump state stored in refs — survives across renders
  // without re-triggering the pump on every state mutation. The pump is
  // driven by handleFiles() adding to `queueRef`, then drained by `pump()`
  // up to UPLOAD_CONCURRENCY in flight.
  const queueRef = useRef<FileEntry[]>([]);
  const inFlightRef = useRef(0);
  const cancelledRef = useRef(false);

  const updateEntry = useCallback(
    (key: string, patch: Partial<FileEntry>) => {
      setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
    },
    [],
  );

  const uploadOne = useCallback(
    async (entry: FileEntry): Promise<void> => {
      if (!sessionId) return;
      updateEntry(entry.key, { state: 'uploading' });
      try {
        const res = await fetch(
          `/api/connectors/manual-upload/sessions/${encodeURIComponent(
            sessionId,
          )}/files?rel_path=${encodeURIComponent(entry.relPath)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: entry.file,
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          chunkCount?: number;
          skipped?: string;
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          updateEntry(entry.key, {
            state: 'failed',
            error: body.fix ?? body.problem ?? `HTTP ${res.status}`,
          });
          return;
        }
        updateEntry(entry.key, {
          state: body.skipped ? 'skipped' : 'indexed',
          chunkCount: body.chunkCount ?? 0,
        });
      } catch (err) {
        updateEntry(entry.key, {
          state: 'failed',
          error: err instanceof Error ? err.message : 'network error',
        });
      }
    },
    [sessionId, updateEntry],
  );

  const pump = useCallback(() => {
    if (cancelledRef.current) return;
    while (inFlightRef.current < UPLOAD_CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      inFlightRef.current += 1;
      void uploadOne(next).finally(() => {
        inFlightRef.current -= 1;
        pump();
      });
    }
  }, [uploadOne]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      // Unmount cancels future-pump scheduling. In-flight requests run to
      // completion server-side — that's fine, the next time the user opens
      // the wizard they'll see those files counted in the manage drawer.
      cancelledRef.current = true;
    };
  }, []);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const accepted: FileEntry[] = [];
      const rejected: { name: string; reason: string }[] = [];
      const seen = new Set<string>(entries.map((e) => e.key));
      for (const f of files) {
        // `webkitRelativePath` is the in-folder path (e.g.
        // "grain/2022-11-07/recording.md") when the picker has
        // `webkitdirectory` set. Drag-and-drop falls back to `name` and
        // loses the folder hierarchy — that's an HTML drag-and-drop
        // limitation we accept for v1.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relPath = (f as any).webkitRelativePath || f.name;
        // Mirror the server's allow/deny policy — skipping ignored files on
        // the client avoids round-tripping 15k irrelevant files from a repo
        // dump (node_modules/.git/dist/lockfiles/binaries) before the server
        // rejects them. Same fn the route imports, so client and server can
        // never drift.
        if (!shouldIndexByPath(relPath)) {
          rejected.push({ name: relPath, reason: 'ignored path or extension' });
          continue;
        }
        if (f.size > MANUAL_UPLOAD_MAX_FILE_BYTES) {
          rejected.push({
            name: relPath,
            reason: `exceeds ${Math.round(MANUAL_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB`,
          });
          continue;
        }
        const key = `${relPath}:${f.size}:${f.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        accepted.push({ key, file: f, relPath, state: 'queued', chunkCount: 0 });
      }
      if (accepted.length > 0) {
        setEntries((prev) => [...prev, ...accepted]);
        queueRef.current.push(...accepted);
        pump();
      }
      if (rejected.length > 0) {
        setSkipped((prev) => [...prev, ...rejected]);
      }
    },
    [entries, pump],
  );

  function openPicker() {
    fileInputRef.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  const queuedCount = entries.filter((e) => e.state === 'queued' || e.state === 'uploading').length;
  const indexedCount = entries.filter((e) => e.state === 'indexed').length;
  const failedCount = entries.filter((e) => e.state === 'failed').length;
  const totalChunks = entries.reduce((sum, e) => sum + e.chunkCount, 0);
  const allSettled = entries.length > 0 && queuedCount === 0;

  // Group entries by top-level folder for a compact directory-style view.
  const grouped = (() => {
    const map = new Map<string, FileEntry[]>();
    for (const e of entries) {
      const idx = e.relPath.indexOf('/');
      const dir = idx >= 0 ? e.relPath.slice(0, idx) : '(root)';
      const arr = map.get(dir) ?? [];
      arr.push(e);
      map.set(dir, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  })();

  if (!sessionId) {
    return (
      <>
        <div className="rounded-md border border-error/40 bg-[color-mix(in_srgb,var(--error,#dc2626)_8%,transparent)] px-3 py-2 text-[13px] text-text">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-error" aria-hidden />
            <span className="font-medium">Session lost</span>
          </div>
          <p className="mt-1 text-text-muted">
            We didn&apos;t finish creating the upload session. Step back and try again.
          </p>
        </div>
        <AlertDialogFooter>
          <Button variant="secondary" onClick={ctx.goPrev}>
            Back
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={openPicker}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') openPicker();
          }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragOver
              ? 'border-accent bg-accent/5'
              : 'border-border bg-surface-2/40 hover:border-border-strong'
          }`}
        >
          <Upload className="h-5 w-5 text-text-muted" aria-hidden />
          <div className="text-[13px] text-text">Drop a folder, or click to pick one</div>
          <p className="text-[12px] text-text-subtle">
            Code, docs, and config files (markdown, source code, YAML/JSON,
            shell scripts). Up to{' '}
            {Math.round(MANUAL_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB per file. Folder
            structure is preserved; build output and binaries are skipped.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            // Intentionally no `accept` — folder picker would still surface
            // every file regardless, and the path filter below decides what
            // we actually ingest. Trust the picker; filter on the way in.
            // @ts-expect-error - non-standard attributes for folder picker
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              // Reset so re-picking the same folder fires onChange again.
              e.target.value = '';
            }}
          />
        </div>

        {skipped.length > 0 ? (
          <details className="rounded-md border border-border bg-surface-2/30 px-3 py-2 text-[12px] text-text-muted">
            <summary className="cursor-pointer text-text">
              Skipped {skipped.length} file{skipped.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
              {skipped.map((s, i) => (
                <li key={`${s.name}-${i}`} className="flex justify-between gap-3">
                  <span className="truncate font-mono">{s.name}</span>
                  <span className="text-text-subtle">{s.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {entries.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[12px] text-text-muted">
              <span>
                {indexedCount} of {entries.length} indexed
                {failedCount > 0 ? ` · ${failedCount} failed` : ''}
                {totalChunks > 0 ? ` · ${totalChunks.toLocaleString()} chunks` : ''}
              </span>
              {queuedCount > 0 ? (
                <span className="flex items-center gap-1.5 text-text">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {queuedCount} pending
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-success">
                  <Check className="h-3 w-3" aria-hidden /> Done
                </span>
              )}
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-md border border-border bg-bg">
              {grouped.map(([dir, files]) => (
                <div key={dir} className="border-b border-border last:border-b-0">
                  <div className="bg-surface-2/40 px-3 py-1.5 text-[12px] font-medium text-text-muted">
                    {dir} <span className="text-text-subtle">({files.length})</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {files.map((e) => (
                      <li
                        key={e.key}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-text-muted">
                          {e.relPath}
                        </span>
                        <FileStateBadge entry={e} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <AlertDialogFooter>
        <Button variant="ghost" onClick={ctx.goPrev}>
          Back
        </Button>
        <Button
          variant={allSettled ? 'primary' : 'secondary'}
          onClick={() => {
            if (allSettled && indexedCount > 0) {
              toast.success(`${indexedCount} file${indexedCount === 1 ? '' : 's'} indexed`);
            }
            ctx.refreshServer();
            ctx.close();
          }}
        >
          {entries.length === 0
            ? 'Cancel'
            : queuedCount > 0
              ? 'Close — keep uploading'
              : 'Done'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function FileStateBadge({ entry }: { entry: FileEntry }) {
  switch (entry.state) {
    case 'queued':
      return <span className="text-text-subtle">queued</span>;
    case 'uploading':
      return (
        <span className="flex items-center gap-1 text-text">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> uploading
        </span>
      );
    case 'indexed':
      return (
        <span className="flex items-center gap-1 text-success">
          <Check className="h-3 w-3" aria-hidden /> {entry.chunkCount} chunks
        </span>
      );
    case 'skipped':
      return <span className="text-text-subtle">empty</span>;
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-error" title={entry.error ?? ''}>
          <AlertCircle className="h-3 w-3" aria-hidden /> failed
        </span>
      );
  }
}
