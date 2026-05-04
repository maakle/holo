'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';

type Channel = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  memberCount: number | null;
  selected: boolean;
  botNotInChannel: boolean;
};

interface Props {
  initialSelectedCount?: number;
}

export function SlackChannelPicker({ initialSelectedCount }: Props = {}) {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || channels !== null) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/slack/channels');
        const body = (await res.json().catch(() => ({}))) as {
          channels?: Channel[];
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (!cancelled) {
          const list = body.channels ?? [];
          setChannels(list);
          setSelected(new Set(list.filter((c) => c.selected).map((c) => c.id)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, channels]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/slack/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: [...selected] }),
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
      if (body.triggeredSync) notifySyncTriggered('slack');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = channels
    ? filter.trim()
      ? channels.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
      : channels
    : [];

  const summaryCount = channels
    ? `${selected.size} / ${channels.length} selected`
    : initialSelectedCount !== undefined
      ? `${initialSelectedCount} selected`
      : '';

  const warningCount = channels?.filter((c) => c.botNotInChannel && selected.has(c.id)).length ?? 0;

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
          {expanded ? 'Hide channel list' : 'Show channel list'}
        </span>
        {summaryCount ? (
          <span className="text-[12px] text-text-muted">{summaryCount}</span>
        ) : null}
      </button>
      {!expanded ? null : loading && !channels ? (
        <div className="border-t border-border px-3 py-4 text-[12px] text-text-muted">
          Loading channels…
        </div>
      ) : error && !channels ? (
        <div className="border-t border-border px-3 py-4 text-[12px] text-error">{error}</div>
      ) : !channels ? null : (
        <>
          {warningCount > 0 ? (
            <div className="flex items-start gap-2 border-t border-border bg-[color-mix(in_srgb,var(--warning,#b45309)_8%,transparent)] px-3 py-2 text-[12px] text-text">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {warningCount} selected channel{warningCount === 1 ? '' : 's'} need the holo bot
                invited. Run <code className="rounded bg-surface-2 px-1">/invite @holo</code> in
                Slack, then re-sync.
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-y border-border px-3 py-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter channels…"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-text-muted">No channels match.</div>
            ) : (
              filtered.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2/40"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] text-text">
                      <span className="truncate font-medium">
                        {c.isPrivate ? null : <span className="text-text-muted">#</span>}
                        {c.name}
                      </span>
                      {c.isPrivate ? (
                        <span className="inline-flex items-center gap-1 rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                          <Lock className="h-2.5 w-2.5" aria-hidden />
                          private
                        </span>
                      ) : null}
                      {c.botNotInChannel ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-warning/40 px-1 text-[10px] uppercase text-warning"
                          title="The holo bot is not a member of this channel. Run /invite @holo in Slack."
                        >
                          <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                          invite needed
                        </span>
                      ) : null}
                    </div>
                    {c.memberCount != null ? (
                      <p className="text-[12px] text-text-muted">
                        {c.memberCount.toLocaleString()} members
                      </p>
                    ) : null}
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
            <div className="text-[12px] text-text-muted">
              {error ? <span className="text-error">{error}</span> : null}
              {!error && savedAt ? <span>Saved · sync was kicked off.</span> : null}
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
