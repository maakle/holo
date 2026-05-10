'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import type { WizardContext } from '../types';

type Project = {
  id: string;
  pathWithNamespace: string;
  defaultBranch: string | null;
  selected: boolean;
};

export interface GitlabProjectsState {
  projects: Project[] | null;
  selected: Set<string>;
  filter: string;
  globs: string[];
  syncStartedAt: number | null;
}

export const gitlabProjectsInitialState: GitlabProjectsState = {
  projects: null,
  selected: new Set(),
  filter: '',
  globs: [],
  syncStartedAt: null,
};

export function gitlabProjectsStep(ctx: WizardContext<GitlabProjectsState>) {
  return <GitlabProjectsStep ctx={ctx} />;
}

function GitlabProjectsStep({ ctx }: { ctx: WizardContext<GitlabProjectsState> }) {
  const { state, setState } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load projects on mount.
  useEffect(() => {
    if (state.projects !== null) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/gitlab/projects');
        const body = (await res.json().catch(() => ({}))) as {
          projects?: Project[];
          globs?: string[];
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (!cancelled) {
          const projects = body.projects ?? [];
          setState({
            projects,
            globs: body.globs ?? [],
            // Pre-select projects already in the allowlist so re-running the
            // wizard doesn't wipe an existing selection.
            selected: new Set(projects.filter((p) => p.selected).map((p) => p.id)),
          });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.projects, setState]);

  const projects = state.projects;
  const selected = state.selected;
  const filter = state.filter;
  const filtered = projects
    ? filter.trim()
      ? projects.filter((p) =>
          p.pathWithNamespace.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : projects
    : [];

  // Select-all / clear-all toggles operate on the *filtered* set so a search
  // narrows the bulk action — bulk-selecting "everything I can see right now"
  // is what the user expects when they've typed `frontend` into the filter.
  const allFilteredChecked =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setState({ selected: next });
  }

  function toggleAllFiltered() {
    if (filtered.length === 0) return;
    const next = new Set(selected);
    if (allFilteredChecked) {
      for (const p of filtered) next.delete(p.id);
    } else {
      for (const p of filtered) next.add(p.id);
    }
    setState({ selected: next });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/gitlab/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [...selected] }),
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
      const patch: Partial<GitlabProjectsState> = {};
      if (body.triggeredSync) {
        notifySyncTriggered('gitlab');
        patch.syncStartedAt = Date.now();
      }
      setState(patch);
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-muted">
          Pick the projects to index. Holo only syncs projects you select here
          — leave it empty and nothing will sync. Both code and prose (issues,
          merge requests, markdown docs) come from the same selection.
        </p>
        {state.globs.length > 0 ? (
          <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
            <span className="font-medium text-text">Note:</span> {state.globs.length}{' '}
            glob pattern{state.globs.length === 1 ? '' : 's'} also include projects via the
            allowlist ({state.globs.slice(0, 3).join(', ')}
            {state.globs.length > 3 ? '…' : ''}). The picker only edits exact-ID
            selections; globs stay as-is.
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
            <input
              type="checkbox"
              checked={allFilteredChecked}
              onChange={toggleAllFiltered}
              aria-label="Select all visible projects"
            />
            <span>Select {filter.trim() ? 'all visible' : 'all'}</span>
          </label>
          <input
            type="text"
            value={filter}
            onChange={(e) => setState({ filter: e.target.value })}
            placeholder="Filter by path…"
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
          />
          <span className="text-[12px] text-text-muted">
            {projects ? `${selected.size} / ${projects.length}` : ''}
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-bg">
          {!projects ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading projects…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-text-muted">
              {projects.length === 0
                ? 'No projects accessible to this token. Check your GitLab membership.'
                : 'No projects match the filter.'}
            </div>
          ) : (
            filtered.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2/40"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">
                    {p.pathWithNamespace}
                  </div>
                  {p.defaultBranch ? (
                    <p className="text-[12px] text-text-muted">
                      default branch:{' '}
                      <span className="font-mono">{p.defaultBranch}</span>
                    </p>
                  ) : null}
                </div>
              </label>
            ))
          )}
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
          disabled={busy || !projects || selected.size === 0}
        >
          {busy ? 'Saving…' : 'Save & continue'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
