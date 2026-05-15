'use client';
import { useEffect, useState } from 'react';
import { InlineCode, Step } from '../snippet';

type GoogleChatBotStatus =
  | 'loading'
  | 'not_configured'
  | 'workspace_unclaimed'
  | 'bot_enabled'
  | 'error';

interface BotStatusResponse {
  status?: GoogleChatBotStatus;
  customerNumber?: string;
}

function useGoogleChatBotStatus(): {
  status: GoogleChatBotStatus;
  customerNumber: string | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<GoogleChatBotStatus>('loading');
  const [customerNumber, setCustomerNumber] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/google-chat-app/bot-status')
      .then((res) => res.json())
      .then((data: BotStatusResponse) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
        setCustomerNumber(data.customerNumber ?? null);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { status, customerNumber, refresh: () => setTick((t) => t + 1) };
}

export function GoogleChatSetup() {
  const { status, customerNumber, refresh } = useGoogleChatBotStatus();

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <span className="text-xs text-text-subtle">Talk to holo from Google Chat</span>
        <p className="text-[13px] leading-6 text-text">
          DM the holo Chat App or @mention it in a space to retrieve context from
          your indexed sources. Requires a one-time install of the holo Chat App
          in your Google Workspace.
        </p>
      </div>

      {status === 'loading' && (
        <p className="text-xs text-text-subtle">Checking workspace…</p>
      )}

      {status === 'not_configured' && <NotConfigured />}

      {status === 'workspace_unclaimed' && <ClaimWorkspace onClaimed={refresh} />}

      {status === 'bot_enabled' && (
        <BotEnabled customerNumber={customerNumber} onUnlink={refresh} />
      )}

      {status === 'error' && (
        <p className="text-xs text-error">
          Couldn&apos;t check Google Chat bot status. Refresh and try again.
        </p>
      )}

      <DeploymentCheck />
    </div>
  );
}

interface HealthzReport {
  audience: 'set' | 'unset';
  serviceAccount: 'unset' | 'malformed' | 'ok';
  serviceAccountClientEmail: string | null;
  tokenExchange: 'skipped' | 'ok' | 'failed';
  tokenExchangeError: string | null;
}

interface TestResponse {
  gateway?: string;
  report?: HealthzReport;
  problem?: string;
  fix?: string;
}

/**
 * Probes the gateway's /google-chat-app/healthz. Distinct from the
 * dashboard `bot-status` check (which reads web-side env + DB) — this one
 * proves the gateway has the right env AND that the SA key can mint a
 * real Google token. Folded into every status branch because operators
 * want one button to debug "is this thing wired up" regardless of which
 * step they're on.
 */
function DeploymentCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/connectors/google-chat-app/test');
      const data = (await res.json()) as TestResponse;
      setResult(data);
    } catch {
      setResult({ problem: 'Network error.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-[13px] font-medium text-text">Verify deployment</div>
          <p className="text-[12px] leading-5 text-text-subtle">
            Pings the gateway to confirm env vars are set and the service
            account can mint Google tokens.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-text-subtle disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Run check'}
        </button>
      </div>

      {result?.problem && (
        <div className="rounded border border-error/40 bg-error/10 px-3 py-2 text-[12px] leading-5 text-text">
          <div className="font-medium text-error">{result.problem}</div>
          {result.fix && <div className="text-text-subtle">{result.fix}</div>}
        </div>
      )}

      {result?.report && (
        <DeploymentReport report={result.report} gateway={result.gateway} />
      )}
    </div>
  );
}

function DeploymentReport({
  report,
  gateway,
}: {
  report: HealthzReport;
  gateway?: string;
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 font-mono text-[11px]">
      {gateway && (
        <>
          <dt className="text-text-subtle">gateway</dt>
          <dd className="text-text">{gateway}</dd>
        </>
      )}
      <dt className="text-text-subtle">audience</dt>
      <dd className={report.audience === 'set' ? 'text-success' : 'text-error'}>
        {report.audience}
      </dd>
      <dt className="text-text-subtle">service_account</dt>
      <dd
        className={
          report.serviceAccount === 'ok'
            ? 'text-success'
            : report.serviceAccount === 'unset'
              ? 'text-error'
              : 'text-error'
        }
      >
        {report.serviceAccount}
        {report.serviceAccountClientEmail && (
          <span className="text-text-subtle"> ({report.serviceAccountClientEmail})</span>
        )}
      </dd>
      <dt className="text-text-subtle">token_exchange</dt>
      <dd
        className={
          report.tokenExchange === 'ok'
            ? 'text-success'
            : report.tokenExchange === 'skipped'
              ? 'text-text-subtle'
              : 'text-error'
        }
      >
        {report.tokenExchange}
      </dd>
      {report.tokenExchangeError && (
        <>
          <dt className="text-text-subtle">error</dt>
          <dd className="text-error">{report.tokenExchangeError}</dd>
        </>
      )}
    </dl>
  );
}

function NotConfigured() {
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-4">
      <p className="text-[13px] leading-6 text-text">
        The holo Google Chat App isn&apos;t configured on this deployment yet.
        An operator must:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-6 text-text">
        <li>
          Create a Google Cloud project, enable the Chat API, and create a
          service account.
        </li>
        <li>
          Configure the Chat app to point at{' '}
          <InlineCode>{`{GATEWAY}/google-chat-app/events`}</InlineCode> (HTTP
          endpoint mode).
        </li>
        <li>
          Set <InlineCode>GOOGLE_CHAT_APP_PROJECT_NUMBER</InlineCode> (Cloud
          project number) and{' '}
          <InlineCode>GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON</InlineCode> on
          gateway + worker, then redeploy.
        </li>
      </ol>
      <p className="text-[12px] text-text-subtle">
        Full guide:{' '}
        <a
          href="https://github.com/maakle/holo/blob/main/docs/connectors/google-chat-app.md"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          docs/connectors/google-chat-app.md
        </a>
      </p>
    </div>
  );
}

function ClaimWorkspace({ onClaimed }: { onClaimed: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/connectors/google-chat-app/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerNumber: value.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; problem?: string };
      if (res.ok && data.ok) {
        onClaimed();
        return;
      }
      setErr(data.problem ?? 'Failed to register the Workspace.');
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        Install the holo Chat App in your Google Workspace (your admin must
        publish it to your domain in Google Admin → Apps → Google Workspace
        Marketplace → manage apps).
      </Step>
      <Step n={2}>
        Copy your <strong>Google customer ID</strong> from Google Admin Console
        → <em>Account</em> → <em>Account settings</em>. It looks like{' '}
        <InlineCode>C0xxxxxxx</InlineCode>.
      </Step>
      <Step n={3}>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="C0xxxxxxx"
            className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus:border-accent"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || value.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Registering…' : 'Register Workspace'}
          </button>
          {err && <span className="text-xs text-error">{err}</span>}
        </form>
      </Step>
      <Step n={4}>
        Once registered, DM <InlineCode>@holo</InlineCode> in Google Chat or
        @mention it in any space — replies thread under your message.
      </Step>
    </ol>
  );
}

function BotEnabled({
  customerNumber,
  onUnlink,
}: {
  customerNumber: string | null;
  onUnlink: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function unlink() {
    if (!confirm('Unlink this Google Workspace? The bot will stop replying until re-registered.')) {
      return;
    }
    setBusy(true);
    try {
      await fetch('/api/connectors/google-chat-app/claim', { method: 'DELETE' });
      onUnlink();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        <span className="text-success">
          ✓ holo Chat App is active for Workspace{' '}
          <InlineCode>{customerNumber ?? '—'}</InlineCode>.
        </span>
      </Step>
      <Step n={2}>
        Open a DM with the <strong>holo</strong> app in Google Chat and ask:{' '}
        <InlineCode>what do we know about onboarding?</InlineCode>
      </Step>
      <Step n={3}>
        Or @mention the bot in any space:{' '}
        <InlineCode>@holo what shipped last week?</InlineCode> The reply threads
        under your message.
      </Step>
      <Step n={4}>
        <button
          onClick={unlink}
          disabled={busy}
          className="text-xs text-text-subtle underline-offset-2 transition-colors hover:text-text hover:underline disabled:opacity-50"
        >
          {busy ? 'Unlinking…' : 'Unlink this Workspace'}
        </button>
      </Step>
    </ol>
  );
}
