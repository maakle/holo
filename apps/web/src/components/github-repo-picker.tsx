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

interface Props {
  /** Number of allowlist entries already saved on the server, for the
   * collapsed-state count. */
  initialSelectedCount?: number;
  /** True when the allowlist is empty for github (= default-all mode).
   * Lets the collapsed state render "All repos" without having to hit
   * GitHub for the actual repo count. */
  initialDefaultAll?: boolean;
}

export function GithubRepoPicker({
  initialSelectedCount,
  initialDefaultAll,
}: Props = {}) {
  const router = useRouter();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [defaultAll, setDefaultAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Lazy fetch — only hit GitHub when the user actually opens the list.
  useEffect(() => {
    if (!expanded || repos !== null) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/github/repos');
        const body = (await res.json().catch(() => ({}))) as {
          repos?: Repo[];
          defaultAll?: boolean;
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
          setDefaultAll(Boolean(body.defaultAll));
          // Clear any stale error from a prior failed save — the fact that we
          // just fetched the live repo list proves auth/network are healthy.
          setError(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, repos]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // If every visible repo is checked, send `defaultAll: true` so the
      // server clears the allowlist and the runner falls back to "all
      // installation repos" — meaning newly-installed repos auto-include
      // without re-saving.
      const allChecked =
        repos !== null &&
        repos.length > 0 &&
        repos.every((r) => selected.has(r.fullName));
      const payload = allChecked
        ? { defaultAll: true }
        : { repos: [...selected] };
      const res = await fetch('/api/connectors/github/repos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      setDefaultAll(allChecked);
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

  const filtered = repos
    ? filter.trim()
      ? repos.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()))
      : repos
    : [];

  // Collapsed count: prefer the live fetched count once we have it; otherwise
  // fall back to the server-rendered allowlist size so we don't have to hit
  // GitHub just to populate a number.
  // In default-all mode (no allowlist rows), show "All · N" so the user
  // understands every repo — including future ones — is being synced.
  const allChecked =
    repos !== null && repos.length > 0 && repos.every((r) => selected.has(r.fullName));
  // Default-all mode shows "All repos" identically whether collapsed or
  // expanded — the count is misleading since new repos auto-include
  // and the expanded list visually shows what's there. The X / N format
  // only kicks in when the user has narrowed the selection.
  const summaryCount = repos
    ? allChecked
      ? 'All repos'
      : `${selected.size} / ${repos.length} selected`
    : initialDefaultAll
      ? 'All repos'
      : initialSelectedCount !== undefined
        ? `${initialSelectedCount} selected`
        : '';

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
        {summaryCount ? (
          <span className="text-[12px] text-text-muted">{summaryCount}</span>
        ) : null}
      </button>
      {!expanded ? null : loading && !repos ? (
        <div className="border-t border-border px-3 py-4 text-[12px] text-text-muted">
          Loading repos…
        </div>
      ) : error && !repos ? (
        <div className="border-t border-border px-3 py-4 text-[12px] text-error">{error}</div>
      ) : !repos ? null : (
      <>
      {defaultAll && allChecked ? (
        <div className="border-t border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
          <strong className="font-medium text-text">All repos</strong> · default. Newly-installed
          repos will sync automatically. Uncheck any to narrow the selection.
        </div>
      ) : null}
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
