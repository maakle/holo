'use client';
import { useEffect, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';
import type { WizardContext } from '../types';

type Space = {
  name: string;
  displayName: string;
  spaceType: 'SPACE_TYPE_UNSPECIFIED' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  isDirectMessage: boolean;
  selected: boolean;
};

export interface GoogleChatSpacesState {
  spaces: Space[] | null;
  selected: Set<string>;
  filter: string;
}

export const googleChatSpacesInitialState: GoogleChatSpacesState = {
  spaces: null,
  selected: new Set(),
  filter: '',
};

export function googleChatSpacesStep(ctx: WizardContext<GoogleChatSpacesState>) {
  return <GoogleChatSpacesStep ctx={ctx} />;
}

function GoogleChatSpacesStep({ ctx }: { ctx: WizardContext<GoogleChatSpacesState> }) {
  const { state, setState } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.spaces !== null) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch('/api/connectors/google-chat/spaces');
        const body = (await res.json().catch(() => ({}))) as {
          spaces?: Space[];
          fix?: string;
          problem?: string;
        };
        if (!res.ok) {
          if (!cancelled) setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
          return;
        }
        if (!cancelled) {
          const fetched = body.spaces ?? [];
          setState({
            spaces: fetched,
            // Pre-select whatever's already in the allowlist so re-running the
            // picker shows the user's existing choices rather than starting empty.
            selected: new Set(fetched.filter((s) => s.selected).map((s) => s.name)),
          });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.spaces, setState]);

  const spaces = state.spaces;
  const selected = state.selected;
  const filter = state.filter;
  // DMs land in the list with an opt-in checkbox but stay unselected by
  // default — admins shouldn't accidentally ingest 1:1 chats by clicking
  // "Select all."
  const selectable = spaces ? spaces.filter((s) => !s.isDirectMessage) : [];
  const filtered = spaces
    ? filter.trim()
      ? spaces.filter((c) =>
          (c.displayName || c.name).toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : spaces
    : [];
  const allChecked =
    selectable.length > 0 && selectable.every((s) => selected.has(s.name));

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setState({ selected: next });
  }

  function toggleAll() {
    if (!spaces) return;
    setState({
      selected: allChecked
        ? new Set()
        : new Set(selectable.map((s) => s.name)),
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        allChecked && spaces
          ? { defaultAll: true }
          : { spaces: [...selected] };
      const res = await fetch('/api/connectors/google-chat/spaces', {
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
      if (body.triggeredSync) notifySyncTriggered('google-chat');
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
          Pick the Google Chat spaces to sync, or hit &ldquo;Select all&rdquo;
          to grab every space the impersonation user is in. DMs are listed
          but excluded from &ldquo;Select all&rdquo; — opt in individually if
          you want them.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label="Select all spaces"
            />
            <span>Select all</span>
          </label>
          <input
            type="text"
            value={filter}
            onChange={(e) => setState({ filter: e.target.value })}
            placeholder="Filter spaces…"
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
          />
          <span className="text-[12px] text-text-muted">
            {spaces ? `${selected.size} / ${spaces.length}` : ''}
          </span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-bg">
          {!spaces ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading spaces…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-text-muted">
              {spaces.length === 0
                ? 'No spaces visible to the impersonation user. Add them to a space in Google Chat and re-open this picker.'
                : 'No spaces match.'}
            </div>
          ) : (
            filtered.map((s) => (
              <label
                key={s.name}
                className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2/40"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(s.name)}
                  onChange={() => toggle(s.name)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] text-text">
                    <span className="truncate font-medium">
                      {s.displayName || (s.isDirectMessage ? 'Direct message' : 'Unnamed space')}
                    </span>
                    {s.isDirectMessage ? (
                      <span className="inline-flex items-center gap-1 rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                        <MessageSquare className="h-2.5 w-2.5" aria-hidden />
                        dm
                      </span>
                    ) : s.spaceType === 'GROUP_CHAT' ? (
                      <span className="inline-flex items-center rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                        group
                      </span>
                    ) : null}
                  </div>
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
          disabled={busy || !spaces || selected.size === 0}
        >
          {busy ? 'Saving…' : 'Save & continue'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
