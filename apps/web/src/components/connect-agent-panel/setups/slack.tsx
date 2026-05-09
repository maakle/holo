'use client';
import { useEffect, useState } from 'react';
import { InlineCode, Step } from '../snippet';

type SlackBotStatus = 'loading' | 'not_connected' | 'ingest_only' | 'bot_enabled' | 'error';

function useSlackBotStatus(): SlackBotStatus {
  const [status, setStatus] = useState<SlackBotStatus>('loading');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/slack/bot-status')
      .then((res) => res.json())
      .then((data: { status?: SlackBotStatus }) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

export function SlackSetup() {
  // The Slack bot rides on the same Slack app used for ingest. Behavior here
  // is status-aware:
  //  - not_connected: send the user to /connections to install Slack first
  //  - ingest_only:   prompt re-auth so Slack adds the bot scopes
  //  - bot_enabled:   show the success state and how to use @holo
  const status = useSlackBotStatus();

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-warning">
            Beta
          </span>
          <span className="text-xs text-text-subtle">Talk to holo from Slack</span>
        </div>
        <p className="text-[13px] leading-6 text-text">
          Mention <InlineCode>@holo</InlineCode> in any channel or DM, or run{' '}
          <InlineCode>/holo</InlineCode>, to retrieve context from your indexed sources. The
          bot uses the same Slack connection as your ingest sync.
        </p>
      </div>

      {status === 'loading' && (
        <p className="text-xs text-text-subtle">Checking workspace…</p>
      )}

      {status === 'not_connected' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-6 text-text">
            You haven&apos;t connected Slack yet. Install the holo Slack app first — the bot
            and ingest sync share the same install.
          </p>
          <a
            href="/connections"
            className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#611f63]"
          >
            <SlackMark />
            Connect Slack →
          </a>
        </div>
      )}

      {status === 'ingest_only' && <SlackReauthCta />}

      {status === 'bot_enabled' && (
        <ol className="list-none space-y-4">
          <Step n={1}>
            <span className="text-success">
              ✓ <InlineCode>@holo</InlineCode> is active in your workspace.
            </span>
          </Step>
          <Step n={2}>
            Invite the bot into any channel and ping it:{' '}
            <InlineCode>/invite @holo</InlineCode>, then{' '}
            <InlineCode>@holo what do we know about onboarding?</InlineCode>
          </Step>
          <Step n={3}>
            Or use the slash command anywhere: <InlineCode>/holo &lt;your question&gt;</InlineCode>.
            Add <InlineCode>--public</InlineCode> to share the answer with the channel.
          </Step>
          <Step n={4}>
            DMs work too — open a DM with <InlineCode>@holo</InlineCode> and ask directly.
          </Step>
        </ol>
      )}

      {status === 'error' && (
        <p className="text-xs text-error">
          Couldn&apos;t check Slack bot status. Refresh and try again.
        </p>
      )}
    </div>
  );
}

/**
 * Re-auth button: the existing /api/connectors/[provider]/initiate route
 * accepts POST and returns { authorizeUrl } — we POST programmatically and
 * navigate the browser there. Same pattern as the connect-wizard but inline.
 */
function SlackReauthCta() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reauth() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/connectors/slack/initiate', { method: 'POST' });
      const data = (await res.json()) as { authorizeUrl?: string; problem?: string };
      if (res.ok && data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      setErr(data.problem ?? 'Failed to start Slack re-auth.');
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-6 text-text">
        Your Slack workspace is connected for ingest, but the <InlineCode>@holo</InlineCode>{' '}
        bot needs additional scopes (mentions, DMs, <InlineCode>chat:write</InlineCode>, slash
        command). Re-authorize to enable the bot — Slack will prompt you to approve the new
        scopes.
      </p>
      <button
        onClick={reauth}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#611f63] disabled:opacity-50"
      >
        <SlackMark />
        {busy ? 'Redirecting…' : 'Re-authorize for @holo bot'}
      </button>
      {err && <p className="text-xs text-error">{err}</p>}
    </div>
  );
}

function SlackMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 14.5a2 2 0 1 1 2 2H5v-2zm1-1a2 2 0 1 1-2-2h2v2zM10.5 5a2 2 0 1 1 2 2v2h-2V5zm1 1a2 2 0 1 1-2 2v-2h2zM19 9.5a2 2 0 1 1-2-2h2v2zm-1 1a2 2 0 1 1 2 2h-2v-2zM13.5 19a2 2 0 1 1-2-2v-2h2v4zm-1-1a2 2 0 1 1 2-2v2h-2z"
        fill="currentColor"
      />
    </svg>
  );
}
