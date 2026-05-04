'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';

type Repo = {
  fullName: string;
  private: boolean;
  description: string | null;
  fork: boolean;
  pushedAt: string | null;
  selected: boolean;
};

export function GithubRepoPicker() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/connectors/github/repos');
        const body = (await res.json().catch(() => ({}))) as {
          repos?: Repo[];
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (!cancelled) {
          const list = body.repos ?? [];
          setRepos(list);
          setSelected(new Set(list.filter((r) => r.selected).map((r) => r.fullName)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/github/repos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repos: [...selected] }),
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
      setSavedAt(Date.now());
      if (body.triggeredSync) notifySyncTriggered('github');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function toggle(fullName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  if (loading) {
    return <div className="mt-3 text-[12px] text-text-muted">Loading repos…</div>;
  }
  if (error && !repos) {
    return <div className="mt-3 text-[12px] text-error">{error}</div>;
  }
  if (!repos) return null;

  const filtered = filter.trim()
    ? repos.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()))
    : repos;

  return (
    <div className="mt-3 rounded-md border border-border bg-bg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/40"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden />
        )}
        <span className="flex-1 text-[13px] font-medium text-text">
          {expanded ? 'Hide repository list' : 'Show repository list'}
        </span>
        <span className="text-[12px] text-text-muted">
          {selected.size} / {repos.length} selected
        </span>
      </button>
      {!expanded ? null : (
      <>
      <div className="flex items-center gap-2 border-y border-border px-3 py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repos…"
          className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-text-muted">No repos match.</div>
        ) : (
          filtered.map((r) => (
            <label
              key={r.fullName}
              className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2/40"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.has(r.fullName)}
                onChange={() => toggle(r.fullName)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-text">
                  <span className="truncate font-medium">{r.fullName}</span>
                  {r.private ? (
                    <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                      private
                    </span>
                  ) : null}
                  {r.fork ? (
                    <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                      fork
                    </span>
                  ) : null}
                </div>
                {r.description ? (
                  <p className="truncate text-[12px] text-text-muted">{r.description}</p>
                ) : null}
              </div>
            </label>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <div className="text-[12px] text-text-muted">
          {error ? <span className="text-error">{error}</span> : null}
          {!error && savedAt ? (
            <span>Saved · scheduler picks up changes on next worker boot or sync.</span>
          ) : null}
        </div>
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save selection'}
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
