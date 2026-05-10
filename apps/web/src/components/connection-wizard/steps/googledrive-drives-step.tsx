'use client';
import { useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  User,
} from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import type { WizardContext } from '../types';

const MY_DRIVE_KEY = 'mydrive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Encoders mirror packages/connectors/src/googledrive/scopes.ts. Inlined so
// the picker doesn't pull the connector barrel (which transitively requires
// tree-sitter, a native module that breaks the browser bundle).
function encodeDrive(id: string): string {
  return `drive:${id}`;
}
function encodeFolder(id: string): string {
  return `folder:${id}`;
}
function encodeFile(id: string): string {
  return `file:${id}`;
}

interface MyDrive {
  key: string;
  rootFolderId: string;
  label: string;
  selected: boolean;
}
interface SharedDriveRoot {
  id: string;
  name: string;
  rootFolderId: string;
  selected: boolean;
}
interface SavedScope {
  pattern: string;
  kind: 'folder' | 'file' | 'drive' | 'mydrive';
  id: string | null;
  label: string;
}
interface ChildNode {
  kind: 'folder' | 'file';
  id: string;
  name: string;
  mimeType: string;
  driveId: string | null;
}

/**
 * One node in the rendered tree. Roots are either MyDrive or a Shared
 * Drive; descendants are folders or files. Keys are unique within the tree
 * so children can be cached by parent-key.
 */
interface TreeNode {
  /** Stable key used in expanded/selected sets. */
  key: string;
  /** Allowlist pattern this node would write if selected. */
  pattern: string;
  label: string;
  kind: 'mydrive' | 'drive' | 'folder' | 'file';
  /** Folder/drive id used to fetch children (null for files / mydrive root we already know). */
  folderId: string | null;
  /** Shared Drive context for descendant queries — null inside My Drive. */
  driveId: string | null;
  /** Depth in the tree, used for indentation. */
  depth: number;
}

export interface GoogleDriveDrivesState {
  loaded: boolean;
  myDrive: MyDrive | null;
  sharedDrives: SharedDriveRoot[];
  /** Currently selected pattern strings (e.g. `mydrive`, `drive:X`, `folder:Y`, `file:Z`). */
  selected: Set<string>;
  /** Human-readable label per pattern — sent back on PUT for chip rendering. */
  labels: Record<string, string>;
  /** Expanded folder/drive keys. */
  expanded: Set<string>;
  /** Child cache keyed by parent node key. Loading shows null. */
  children: Record<string, ChildNode[] | 'loading' | 'error'>;
  savedScopes: SavedScope[];
}

export const googleDriveDrivesInitialState: GoogleDriveDrivesState = {
  loaded: false,
  myDrive: null,
  sharedDrives: [],
  selected: new Set(),
  labels: {},
  expanded: new Set(),
  children: {},
  savedScopes: [],
};

export function googleDriveDrivesStep(ctx: WizardContext<GoogleDriveDrivesState>) {
  return <GoogleDriveDrivesStep ctx={ctx} />;
}

function GoogleDriveDrivesStep({ ctx }: { ctx: WizardContext<GoogleDriveDrivesState> }) {
  const { state, setState } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: roots + saved selections.
  useEffect(() => {
    if (state.loaded) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/googledrive/drives');
        const body = (await res.json().catch(() => ({}))) as {
          myDrive?: MyDrive;
          sharedDrives?: SharedDriveRoot[];
          savedScopes?: SavedScope[];
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (cancelled) return;
        const myDrive = body.myDrive ?? null;
        const sharedDrives = body.sharedDrives ?? [];
        const savedScopes = body.savedScopes ?? [];

        const sel = new Set<string>();
        const labels: Record<string, string> = {};
        if (myDrive?.selected) {
          sel.add(MY_DRIVE_KEY);
          labels[MY_DRIVE_KEY] = myDrive.label;
        }
        for (const d of sharedDrives) {
          if (d.selected) {
            const pat = encodeDrive(d.id);
            sel.add(pat);
            labels[pat] = d.name;
          }
        }
        for (const s of savedScopes) {
          sel.add(s.pattern);
          labels[s.pattern] = s.label;
        }
        setState({
          loaded: true,
          myDrive,
          sharedDrives,
          savedScopes,
          selected: sel,
          labels,
        });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.loaded, setState]);

  async function loadChildren(node: TreeNode): Promise<void> {
    if (node.kind === 'file') return;
    if (state.children[node.key] !== undefined) return;
    if (node.folderId === null) return;
    setState({ children: { ...state.children, [node.key]: 'loading' } });
    try {
      const params = new URLSearchParams({ folderId: node.folderId });
      if (node.driveId) params.set('driveId', node.driveId);
      const res = await fetch(
        `/api/connectors/googledrive/drives?${params.toString()}`,
      );
      const body = (await res.json().catch(() => ({}))) as {
        children?: ChildNode[];
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setState({ children: { ...state.children, [node.key]: 'error' } });
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      setState({
        children: { ...state.children, [node.key]: body.children ?? [] },
      });
    } catch (e) {
      setState({ children: { ...state.children, [node.key]: 'error' } });
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }

  function toggleExpand(node: TreeNode): void {
    if (node.kind === 'file') return;
    const next = new Set(state.expanded);
    if (next.has(node.key)) {
      next.delete(node.key);
      setState({ expanded: next });
    } else {
      next.add(node.key);
      setState({ expanded: next });
      void loadChildren(node);
    }
  }

  function toggleSelect(node: TreeNode): void {
    const next = new Set(state.selected);
    const labels = { ...state.labels };
    if (next.has(node.pattern)) {
      next.delete(node.pattern);
      delete labels[node.pattern];
    } else {
      next.add(node.pattern);
      labels[node.pattern] = node.label;
    }
    setState({ selected: next, labels });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const items = [...state.selected].map((pattern) => ({
        pattern,
        label: state.labels[pattern],
      }));
      const res = await fetch('/api/connectors/googledrive/drives', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
        triggeredSync?: boolean;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      if (body.triggeredSync) notifySyncTriggered('googledrive');
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const { loaded, myDrive, sharedDrives, selected, expanded } = state;

  const rootNodes: TreeNode[] = [];
  if (myDrive) {
    rootNodes.push({
      key: 'root:mydrive',
      pattern: MY_DRIVE_KEY,
      label: myDrive.label,
      kind: 'mydrive',
      folderId: myDrive.rootFolderId,
      driveId: null,
      depth: 0,
    });
  }
  for (const d of sharedDrives) {
    rootNodes.push({
      key: `root:drive:${d.id}`,
      pattern: encodeDrive(d.id),
      label: d.name,
      kind: 'drive',
      folderId: d.rootFolderId,
      driveId: d.id,
      depth: 0,
    });
  }

  function renderSubtree(node: TreeNode, out: TreeNode[]): void {
    out.push(node);
    if (node.kind === 'file') return;
    if (!expanded.has(node.key)) return;
    const cached = state.children[node.key];
    if (!cached || cached === 'loading' || cached === 'error') return;
    for (const c of cached) {
      const childNode: TreeNode = {
        key: `${node.key}/${c.kind}:${c.id}`,
        pattern: c.kind === 'folder' ? encodeFolder(c.id) : encodeFile(c.id),
        label: c.name,
        kind: c.kind,
        folderId: c.kind === 'folder' ? c.id : null,
        driveId: node.driveId ?? c.driveId ?? null,
        depth: node.depth + 1,
      };
      renderSubtree(childNode, out);
    }
  }

  const flat: TreeNode[] = [];
  for (const r of rootNodes) renderSubtree(r, flat);

  // Surface saved folder/file scopes whose parent isn't expanded — without
  // these, a user reopening the picker would see no visible trace of their
  // current selections beyond the root checkboxes.
  const orphanSavedScopes = state.savedScopes.filter(
    (s) => (s.kind === 'folder' || s.kind === 'file') && selected.has(s.pattern),
  );

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-muted">
          Pick what to sync. Check an entire drive, a folder (everything inside
          syncs recursively), or just a specific file. Click the arrow to drill
          in — folder contents load on demand.
        </p>

        <div className="max-h-96 overflow-y-auto rounded-md border border-border bg-bg">
          {!loaded ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading drives…
            </div>
          ) : rootNodes.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-text-muted">
              No drives visible to the impersonation user.
            </div>
          ) : (
            flat.map((node) => (
              <TreeRow
                key={node.key}
                node={node}
                checked={selected.has(node.pattern)}
                expanded={expanded.has(node.key)}
                childrenState={state.children[node.key]}
                onToggleExpand={() => toggleExpand(node)}
                onToggleSelect={() => toggleSelect(node)}
              />
            ))
          )}
        </div>

        {orphanSavedScopes.length > 0 ? (
          <div className="flex flex-col gap-1 text-[11px] text-text-subtle">
            <span className="uppercase tracking-[0.04em]">Also synced</span>
            <div className="flex flex-wrap gap-1.5">
              {orphanSavedScopes.map((s) => (
                <button
                  key={s.pattern}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    next.delete(s.pattern);
                    const labels = { ...state.labels };
                    delete labels[s.pattern];
                    setState({ selected: next, labels });
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text hover:border-error/60 hover:text-error"
                  title="Remove from selection"
                >
                  {s.kind === 'folder' ? (
                    <Folder className="h-3 w-3" aria-hidden />
                  ) : (
                    <FileText className="h-3 w-3" aria-hidden />
                  )}
                  <span className="max-w-[180px] truncate">{s.label}</span>
                  <span className="text-text-subtle">×</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="text-[12px] text-text-muted">
          {selected.size === 0
            ? 'Nothing selected yet.'
            : `${selected.size} ${selected.size === 1 ? 'scope' : 'scopes'} selected.`}
        </div>

        {error ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>
      <AlertDialogFooter>
        <Button variant="secondary" onClick={ctx.close} disabled={busy}>
          Skip for now
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={busy || !loaded || selected.size === 0}
        >
          {busy ? 'Saving…' : 'Save & continue'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function TreeRow({
  node,
  checked,
  expanded,
  childrenState,
  onToggleExpand,
  onToggleSelect,
}: {
  node: TreeNode;
  checked: boolean;
  expanded: boolean;
  childrenState: ChildNode[] | 'loading' | 'error' | undefined;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
}) {
  const indent = node.depth * 16;
  const canExpand = node.kind !== 'file';
  const isFolderType =
    node.kind === 'folder' || node.kind === 'drive' || node.kind === 'mydrive';
  return (
    <div className="flex items-start border-b border-border last:border-b-0 hover:bg-surface-2/40">
      <div
        className="flex flex-1 items-start gap-2 px-3 py-2"
        style={{ paddingLeft: 12 + indent }}
      >
        <button
          type="button"
          onClick={canExpand ? onToggleExpand : undefined}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-text-subtle"
          disabled={!canExpand}
          aria-label={canExpand ? (expanded ? 'Collapse' : 'Expand') : undefined}
        >
          {canExpand ? (
            childrenState === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )
          ) : null}
        </button>
        <label className="flex flex-1 cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checked}
            onChange={onToggleSelect}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] text-text">
              <NodeIcon kind={node.kind} mimeType={undefined} />
              <span className="truncate font-medium">{node.label}</span>
              <NodeBadge kind={node.kind} />
            </div>
            {expanded && childrenState === 'error' ? (
              <p className="mt-0.5 text-[11px] text-error">
                Couldn&apos;t load contents — try again.
              </p>
            ) : expanded &&
              Array.isArray(childrenState) &&
              childrenState.length === 0 &&
              isFolderType ? (
              <p
                className="mt-0.5 text-[11px] text-text-subtle"
                style={{ paddingLeft: 0 }}
              >
                Empty.
              </p>
            ) : null}
          </div>
        </label>
      </div>
    </div>
  );
}

function NodeIcon({
  kind,
}: {
  kind: TreeNode['kind'];
  mimeType: string | undefined;
}) {
  if (kind === 'mydrive') return <User className="h-3.5 w-3.5 text-text-muted" aria-hidden />;
  if (kind === 'drive') return <HardDrive className="h-3.5 w-3.5 text-text-muted" aria-hidden />;
  if (kind === 'folder') return <Folder className="h-3.5 w-3.5 text-text-muted" aria-hidden />;
  return <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden />;
}

function NodeBadge({ kind }: { kind: TreeNode['kind'] }) {
  const label =
    kind === 'mydrive'
      ? 'personal'
      : kind === 'drive'
        ? 'shared'
        : kind === 'folder'
          ? 'folder'
          : 'file';
  return (
    <span className="inline-flex items-center rounded border border-border px-1 text-[10px] uppercase text-text-muted">
      {label}
    </span>
  );
}

// Used as a hint elsewhere; export for completeness when the picker is
// reused outside the wizard.
export const GOOGLEDRIVE_FOLDER_MIME = FOLDER_MIME;
