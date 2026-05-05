'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { notifySyncTriggered } from '@/lib/sync-events';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedAs?: string;
}

type Channel = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  memberCount: number | null;
  selected: boolean;
  botNotInChannel: boolean;
};

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Install',
  2: 'Pick channels',
  3: 'Invite bot',
  4: 'First sync',
};

export function SlackOnboardingDialog({ open, onOpenChange, connectedAs }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(2);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInvite, setNeedsInvite] = useState<{ id: string; name: string }[]>([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [chunksIndexed, setChunksIndexed] = useState(0);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2: lazy-load channels when dialog opens. Pre-select all so the
  // wizard's default action is "sync everything" — matches user intent
  // when they hit Connect from a clean state.
  useEffect(() => {
    if (!open || channels !== null) return;
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
          const list = body.channels ?? [];
          setChannels(list);
          setTeamId(body.teamId ?? null);
          setSelected(new Set(list.map((c) => c.id)));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channels]);

  // Step 4: poll sync status. Advance when chunks start indexing OR sync
  // completes (running flips false). Caps at 90s to avoid spinning forever.
  useEffect(() => {
    if (step !== 4 || !syncStartedAt) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch('/api/connectors/slack/sync-status', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { running?: boolean; chunksIndexed?: number };
        if (cancelled) return;
        setSyncRunning(Boolean(body.running));
        setChunksIndexed(body.chunksIndexed ?? 0);
      } finally {
        if (!cancelled) {
          pollTimerRef.current = setTimeout(tick, 3000);
        }
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [step, syncStartedAt]);

  const filtered = channels
    ? filter.trim()
      ? channels.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
      : channels
    : [];
  const allChecked =
    channels !== null && channels.length > 0 && channels.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!channels) return;
    setSelected((prev) =>
      channels.every((c) => prev.has(c.id))
        ? new Set()
        : new Set(channels.map((c) => c.id)),
    );
  }

  async function saveChannels() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        allChecked && channels
          ? { defaultAll: true }
          : { channels: [...selected] };
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
      setJoinedCount(body.joined?.length ?? 0);
      setNeedsInvite(body.needsInvite ?? []);
      if (body.triggeredSync) {
        notifySyncTriggered('slack');
        setSyncStartedAt(Date.now());
      }
      // Skip step 3 if no private channels need invites — go straight to sync.
      setStep((body.needsInvite?.length ?? 0) > 0 ? 3 : 4);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    onOpenChange(false);
  }

  const indexedSomething = chunksIndexed > 0;
  const syncDoneNoIndex =
    step === 4 && syncStartedAt !== null && !syncRunning && Date.now() - syncStartedAt > 4000;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Set up Slack</AlertDialogTitle>
          <AlertDialogDescription>
            {connectedAs ? `Connected to ${connectedAs}. ` : ''}
            Pick the channels to sync, invite the bot to private ones, and run the first sync.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ol className="flex items-center gap-2 text-[12px]">
          {([1, 2, 3, 4] as Step[]).map((s) => {
            const done = s < step;
            const active = s === step;
            return (
              <li
                key={s}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                  active
                    ? 'border-accent text-accent'
                    : done
                      ? 'border-success text-success'
                      : 'border-border text-text-muted'
                }`}
              >
                {done ? (
                  <Check className="h-3 w-3" aria-hidden />
                ) : (
                  <span className="font-medium">{s}</span>
                )}
                <span>{STEP_LABELS[s]}</span>
              </li>
            );
          })}
        </ol>

        {/* Step 1 — installed (auto-done). Briefly visible if user manually
            navigates back; the dialog opens at step 2 by default. */}
        {step === 1 ? (
          <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" aria-hidden />
              <span className="font-medium">App installed</span>
            </div>
            <p className="mt-1 text-text-muted">
              The holo Slack app is installed on{' '}
              <span className="font-medium text-text">{connectedAs ?? 'your workspace'}</span>.
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">
              All channels are pre-selected. Public channels the bot isn&apos;t in yet will be
              auto-joined when you save. Uncheck any to narrow the selection.
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
                onChange={(e) => setFilter(e.target.value)}
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
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning,#b45309)_8%,transparent)] px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div className="text-[13px]">
                  <div className="font-medium text-text">
                    {needsInvite.length} private channel{needsInvite.length === 1 ? '' : 's'}{' '}
                    need{needsInvite.length === 1 ? 's' : ''} the bot invited
                  </div>
                  <p className="mt-1 text-text-muted">
                    Slack doesn&apos;t let bots auto-join private channels. Run{' '}
                    <code className="rounded bg-surface-2 px-1">/invite @holo</code> in each, or
                    skip and add them later.
                  </p>
                </div>
              </div>
            </div>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-bg p-2">
              {needsInvite.map((c) => {
                const href = teamId
                  ? `slack://channel?team=${teamId}&id=${c.id}`
                  : `https://slack.com/app_redirect?channel=${c.id}`;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="text-[13px] text-text">#{c.name}</span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-accent underline-offset-2 hover:underline"
                    >
                      Open in Slack →
                    </a>
                  </li>
                );
              })}
            </ul>
            {joinedCount > 0 ? (
              <p className="text-[12px] text-text-muted">
                Auto-joined {joinedCount} public channel{joinedCount === 1 ? '' : 's'}. Those will
                sync regardless of this step.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-3">
            {indexedSomething ? (
              <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" aria-hidden />
                  <span className="font-medium">Indexing started</span>
                </div>
                <p className="mt-1 text-text-muted">
                  {chunksIndexed.toLocaleString()} chunk{chunksIndexed === 1 ? '' : 's'} indexed
                  so far. Sync continues in the background — you can close this dialog and check
                  progress in Manage.
                </p>
              </div>
            ) : syncDoneNoIndex ? (
              <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[13px] text-text">
                <div className="font-medium">Sync finished — no new content</div>
                <p className="mt-1 text-text-muted">
                  No human messages were found in the channels you selected (yet). New messages
                  will be picked up on the next scheduled sync.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                <span>
                  Sync running… {chunksIndexed > 0 ? `${chunksIndexed} chunks indexed` : 'pulling messages from Slack'}
                </span>
              </div>
            )}
            <p className="text-[12px] text-text-subtle">
              Sync runs in the background even when this dialog is closed. Progress is visible
              under <span className="font-medium text-text">Manage</span> on the Slack row. Slack
              rate-limits how fast we can pull history (about 40 requests per minute), so the
              first sync of a large workspace can take a while; later syncs are incremental.
            </p>
          </div>
        ) : null}

        <AlertDialogFooter>
          {step === 2 ? (
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                Skip for now
              </Button>
              <Button
                variant="primary"
                onClick={saveChannels}
                disabled={busy || !channels || selected.size === 0}
              >
                {busy ? 'Saving…' : 'Save & continue'}
              </Button>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Button variant="secondary" onClick={() => setStep(4)}>
                Skip
              </Button>
              <Button variant="primary" onClick={() => setStep(4)}>
                Done — continue
              </Button>
            </>
          ) : null}
          {step === 4 ? (
            <Button variant="primary" onClick={close}>
              {indexedSomething || syncDoneNoIndex ? 'Done' : 'Close — keep syncing'}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
