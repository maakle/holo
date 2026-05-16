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
  primaryDomains?: string[];
  domainId?: string | null;
  eventsUrl?: string | null;
}

function useGoogleChatBotStatus(): {
  status: GoogleChatBotStatus;
  primaryDomains: string[];
  domainId: string | null;
  eventsUrl: string | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<GoogleChatBotStatus>('loading');
  const [primaryDomains, setPrimaryDomains] = useState<string[]>([]);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/google-chat-app/bot-status')
      .then((res) => res.json())
      .then((data: BotStatusResponse) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
        setPrimaryDomains(data.primaryDomains ?? []);
        setDomainId(data.domainId ?? null);
        setEventsUrl(data.eventsUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return {
    status,
    primaryDomains,
    domainId,
    eventsUrl,
    refresh: () => setTick((t) => t + 1),
  };
}

export function GoogleChatSetup() {
  const { status, primaryDomains, domainId, eventsUrl, refresh } =
    useGoogleChatBotStatus();

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

      {status === 'not_configured' && <NotConfigured eventsUrl={eventsUrl} />}

      {status === 'workspace_unclaimed' && <RegisterDomains onChange={refresh} />}

      {status === 'bot_enabled' && (
        <BotEnabled
          primaryDomains={primaryDomains}
          domainId={domainId}
          onChange={refresh}
        />
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

function NotConfigured({ eventsUrl }: { eventsUrl: string | null }) {
  const endpointUrl = eventsUrl ?? 'https://{your-gateway-host}/google-chat-app/events';
  return (
    <div className="space-y-4 rounded-md border border-warning/40 bg-warning/10 p-4">
      <p className="text-[13px] leading-6 text-text">
        The holo Google Chat App isn&apos;t configured on this deployment yet.
        An operator must complete the three steps below in Google Cloud
        Console, then set env vars on the gateway + worker.
      </p>

      <ol className="list-none space-y-4">
        <Step n={1}>
          <div className="font-medium text-text">
            Create a Cloud project + service account
          </div>
          <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-5 text-text-subtle">
            <li>
              In{' '}
              <ConsoleLink href="https://console.cloud.google.com/projectcreate">
                Google Cloud Console
              </ConsoleLink>
              , create a dedicated project (e.g.{' '}
              <InlineCode>holo-chat-app-prod</InlineCode>).
            </li>
            <li>
              Enable the{' '}
              <ConsoleLink href="https://console.cloud.google.com/apis/library/chat.googleapis.com">
                Google Chat API
              </ConsoleLink>
              .
            </li>
            <li>
              Create a service account (any name, no roles). Generate a JSON
              key and download it — treat as a secret.
            </li>
            <li>
              Note the <strong>Cloud project number</strong> from{' '}
              <em>Project Settings → Project number</em> (12-digit integer,
              not the project ID slug).
            </li>
          </ol>
        </Step>

        <Step n={2}>
          <div className="font-medium text-text">
            Configure the Chat App
          </div>
          <p className="text-[12px] leading-5 text-text-subtle">
            Open the{' '}
            <ConsoleLink href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat">
              Chat API Configuration tab
            </ConsoleLink>{' '}
            and set:
          </p>
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-text-subtle">
            <li>
              <strong>Build as Workspace Add-on:</strong> unchecked
            </li>
            <li>
              <strong>App name:</strong> <InlineCode>holo</InlineCode>
            </li>
            <li>
              <strong>Avatar URL:</strong> any HTTPS-hosted 250×250 PNG
            </li>
            <li>
              <strong>Description:</strong>{' '}
              <InlineCode>Ask holo from Google Chat</InlineCode>
            </li>
            <li>
              <strong>Interactive features:</strong> ON
              <ul className="mt-1 list-[circle] space-y-0.5 pl-4">
                <li>
                  Functionality: check both <em>Receive 1:1 messages</em> and{' '}
                  <em>Join spaces and group conversations</em>
                </li>
                <li>
                  Connection settings: <strong>HTTP endpoint URL</strong>
                </li>
                <li>
                  Endpoint URL (paste this):
                  <div className="mt-1">
                    <InlineCode>{endpointUrl}</InlineCode>
                  </div>
                </li>
                <li>
                  Authentication audience:{' '}
                  <strong>Project number</strong> (Google signs JWTs with{' '}
                  <InlineCode>aud</InlineCode> = your Cloud project number,
                  which is what holo&apos;s gateway verifies). Picking{' '}
                  <em>HTTP endpoint URL</em> will cause every inbound event
                  to fail with <InlineCode>wrong_audience</InlineCode>.
                </li>
              </ul>
            </li>
            <li>
              <strong>Visibility / installation model:</strong> the Cloud
              project is the platform owner, not the tenant boundary —
              the JWT <InlineCode>aud</InlineCode> is your project number
              regardless of which Workspace originated the event.
              Pick based on your deployment shape:
              <ul className="mt-1 list-[circle] space-y-0.5 pl-4">
                <li>
                  <strong>Single-tenant</strong> (just your own Workspace):
                  restrict to your domain.
                </li>
                <li>
                  <strong>Multi-tenant</strong> (hosted holo — other orgs&apos;
                  Workspace admins install it themselves): publish the app to
                  the <strong>Google Workspace Marketplace</strong> on the
                  same Cloud project. Private listings skip public brand
                  review and let you whitelist customer domains.
                </li>
              </ul>
            </li>
            <li>
              <strong>App status:</strong> LIVE — available to users in your
              domain
            </li>
          </ul>
        </Step>

        <Step n={3}>
          <div className="font-medium text-text">
            Set env vars on gateway + worker
          </div>
          <p className="text-[12px] leading-5 text-text-subtle">
            Both variables must be set on <strong>both</strong>{' '}
            <InlineCode>apps/gateway</InlineCode> and{' '}
            <InlineCode>apps/worker</InlineCode>, then redeploy:
          </p>
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-text-subtle">
            <li>
              <InlineCode>GOOGLE_CHAT_APP_PROJECT_NUMBER</InlineCode> — the
              Cloud project number from step 1 (12-digit integer, not the
              project ID).
            </li>
            <li>
              <InlineCode>GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON</InlineCode> —
              the full contents of the service-account JSON key file as a
              single string (mints outbound bot-reply tokens).
            </li>
          </ul>
          <p className="text-[12px] leading-5 text-text-subtle">
            Set them in your deploy platform&apos;s env-var panel (Vercel /
            Render / Fly / k8s secrets). Redeploy both services, then click{' '}
            <strong>Run check</strong> below to verify.
          </p>
        </Step>
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

function ConsoleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:underline"
    >
      {children}
    </a>
  );
}

function RegisterDomains({ onChange }: { onChange: () => void }) {
  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        Install the holo Chat App in your Google Workspace (your admin must
        publish it to your domain in Google Admin → Apps → Google Workspace
        Marketplace → manage apps).
      </Step>
      <Step n={2}>
        Register the Workspace&apos;s verified email domain(s) below. holo
        routes inbound bot messages to this org when the asker&apos;s email
        domain matches.
      </Step>
      <Step n={3}>
        <DomainsForm onSaved={onChange} initial={[]} submitLabel="Register Workspace" />
      </Step>
      <Step n={4}>
        Once registered, DM <InlineCode>@holo</InlineCode> from any user
        with one of the registered domains — replies thread under your
        message.
      </Step>
    </ol>
  );
}

function DomainsForm({
  initial,
  submitLabel,
  onSaved,
}: {
  initial: string[];
  submitLabel: string;
  onSaved: () => void;
}) {
  const [domains, setDomains] = useState<string>(initial.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const parsed = domains
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length === 0) {
      setErr('Enter at least one domain.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/connectors/google-chat-app/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryDomains: parsed }),
      });
      const data = (await res.json()) as { ok?: boolean; problem?: string };
      if (res.ok && data.ok) {
        onSaved();
        return;
      }
      setErr(data.problem ?? 'Failed to save.');
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[12px] text-text-subtle">
          Workspace email domains (comma- or space-separated)
        </span>
        <input
          type="text"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="acme.com, acme.io"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus:border-accent"
          disabled={busy}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || domains.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        {err && <span className="text-xs text-error">{err}</span>}
      </div>
    </form>
  );
}

function BotEnabled({
  primaryDomains,
  domainId,
  onChange,
}: {
  primaryDomains: string[];
  domainId: string | null;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlink() {
    if (!confirm('Unlink this Google Workspace? The bot will stop replying until re-registered.')) {
      return;
    }
    setBusy(true);
    try {
      await fetch('/api/connectors/google-chat-app/claim', { method: 'DELETE' });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        <div className="space-y-1">
          <span className="text-success">
            ✓ holo Chat App is active for{' '}
            {primaryDomains.length === 1 ? (
              <InlineCode>{primaryDomains[0]}</InlineCode>
            ) : (
              <>
                {primaryDomains.map((d, i) => (
                  <span key={d}>
                    {i > 0 && ', '}
                    <InlineCode>{d}</InlineCode>
                  </span>
                ))}
              </>
            )}
            {domainId && (
              <span className="text-text-subtle">
                {' '}— routing cached
              </span>
            )}
            .
          </span>
        </div>
      </Step>
      <Step n={2}>
        DM <InlineCode>@holo</InlineCode> in Google Chat from any user with
        a registered domain, or @mention it in a space:{' '}
        <InlineCode>@holo what shipped last week?</InlineCode>
      </Step>
      <Step n={3}>
        {editing ? (
          <div className="space-y-2">
            <DomainsForm
              initial={primaryDomains}
              submitLabel="Save changes"
              onSaved={() => {
                setEditing(false);
                onChange();
              }}
            />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-text-subtle underline-offset-2 transition-colors hover:text-text hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-text-subtle underline-offset-2 transition-colors hover:text-text hover:underline"
            >
              Edit domains
            </button>
            <button
              type="button"
              onClick={unlink}
              disabled={busy}
              className="text-text-subtle underline-offset-2 transition-colors hover:text-text hover:underline disabled:opacity-50"
            >
              {busy ? 'Unlinking…' : 'Unlink this Workspace'}
            </button>
          </div>
        )}
      </Step>
    </ol>
  );
}

