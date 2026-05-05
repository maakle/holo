'use client';
import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import type { WizardContext } from '../types';

type Channel = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  memberCount: number | null;
  selected: boolean;
  botNotInChannel: boolean;
};

export interface SlackChannelsState {
  channels: Channel[] | null;
  selected: Set<string>;
  filter: string;
  teamId: string | null;
  needsInvite: { id: string; name: string }[];
  joinedCount: number;
  syncStartedAt: number | null;
}

export const slackChannelsInitialState: SlackChannelsState = {
  channels: null,
  selected: new Set(),
  filter: '',
  teamId: null,
  needsInvite: [],
  joinedCount: 0,
  syncStartedAt: null,
};

export function slackChannelsStep(ctx: WizardContext<SlackChannelsState>) {
  return <SlackChannelsStep ctx={ctx} />;
}

function SlackChannelsStep({ ctx }: { ctx: WizardContext<SlackChannelsState> }) {
  const { state, setState } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load channels on mount.
  useEffect(() => {
    if (state.channels !== null) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/slack/channels');
        const body = (await res.json().catch(() => ({}))) as {
          channels?: Channel[];
          teamId?: string | null;
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (!cancelled) {
          setState({
            channels: body.channels ?? [],
            teamId: body.teamId ?? null,
            selected: new Set(),
          });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.channels, setState]);

  const channels = state.channels;
  const selected = state.selected;
  const filter = state.filter;
  const filtered = channels
    ? filter.trim()
      ? channels.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
      : channels
    : [];
  const allChecked =
    channels !== null && channels.length > 0 && channels.every((c) => selected.has(c.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setState({ selected: next });
  }

  function toggleAll() {
    if (!channels) return;
    setState({
      selected: channels.every((c) => selected.has(c.id))
        ? new Set()
        : new Set(channels.map((c) => c.id)),
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        allChecked && channels ? { defaultAll: true } : { channels: [...selected] };
      const res = await fetch('/api/connectors/slack/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
        joined?: string[];
        needsInvite?: { id: string; name: string }[];
        triggeredSync?: boolean;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      const patch: Partial<SlackChannelsState> = {
        joinedCount: body.joined?.length ?? 0,
        needsInvite: body.needsInvite ?? [],
      };
      if (body.triggeredSync) {
        notifySyncTriggered('slack');
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
          Pick the channels to sync, or hit &ldquo;Select all&rdquo; to grab everything. Public
          channels the bot isn&apos;t in yet will be auto-joined when you save.
        </p>
        <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
          <span className="font-medium text-text">Heads up:</span> the first sync runs in the
          background and can take 10–60 minutes for a workspace this size — Slack rate-limits
          how fast we can read history. You can close this dialog at any point; sync keeps
          going. Subsequent syncs are incremental and much faster.
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label="Select all channels"
            />
            <span>Select all</span>
          </label>
          <input
            type="text"
            value={filter}
            onChange={(e) => setState({ filter: e.target.value })}
            placeholder="Filter channels…"
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
          />
          <span className="text-[12px] text-text-muted">
            {channels ? `${selected.size} / ${channels.length}` : ''}
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-bg">
          {!channels ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading channels…
            </div>
          ) : filtered.length === 0 ? (
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
        {error ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>
      <AlertDialogFooter>
        <Button variant="secondary" onClick={ctx.close} disabled={busy}>
          Skip for now
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={busy || !channels || selected.size === 0}
        >
          {busy ? 'Saving…' : 'Save & continue'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
