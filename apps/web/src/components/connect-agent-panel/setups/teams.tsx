'use client';
import { useEffect, useState } from 'react';
import { InlineCode, Step } from '../snippet';

type TeamsBotStatus =
  | 'loading'
  | 'not_configured'
  | 'tenant_unclaimed'
  | 'bot_enabled'
  | 'error';

interface BotStatusResponse {
  status?: TeamsBotStatus;
  installationCount?: number;
}

function useTeamsBotStatus(): {
  status: TeamsBotStatus;
  installationCount: number;
  refresh: () => void;
} {
  const [status, setStatus] = useState<TeamsBotStatus>('loading');
  const [installationCount, setInstallationCount] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/teams-bot/bot-status')
      .then((res) => res.json())
      .then((data: BotStatusResponse) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
        setInstallationCount(data.installationCount ?? 0);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { status, installationCount, refresh: () => setTick((t) => t + 1) };
}

export function TeamsSetup() {
  const { status, installationCount, refresh } = useTeamsBotStatus();

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <span className="text-xs text-text-subtle">Talk to holo from Microsoft Teams</span>
        <p className="text-[13px] leading-6 text-text">
          DM the holo bot or @mention it in any team channel or group chat to
          retrieve context from your indexed sources. Requires sideloading the
          holo app package via Teams Admin Center — once per Azure AD tenant.
        </p>
      </div>

      {status === 'loading' && (
        <p className="text-xs text-text-subtle">Checking tenants…</p>
      )}

      {status === 'not_configured' && <NotConfigured />}

      {status === 'tenant_unclaimed' && <ClaimTenant onClaimed={refresh} />}

      {status === 'bot_enabled' && (
        <BotEnabled installationCount={installationCount} onChange={refresh} />
      )}

      {status === 'error' && (
        <p className="text-xs text-error">
          Couldn&apos;t check Teams bot status. Refresh and try again.
        </p>
      )}

      <DeploymentCheck />
    </div>
  );
}

interface HealthzReport {
  appId: 'set' | 'unset';
  appSecret: 'set' | 'unset';
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
 * Probes the gateway's /teams-bot/healthz. Distinct from the dashboard
 * `bot-status` check (which reads web-side env + DB) — this one proves
 * the gateway has the right env AND can mint a real Bot Framework token.
 * Folded into every status branch because operators want one button to
 * debug "is this thing wired up" regardless of which step they're on.
 */
function DeploymentCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/connectors/teams-bot/test');
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
            Pings the gateway to confirm env vars are set and the Azure AD app
            can mint Bot Framework tokens.
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
      <dt className="text-text-subtle">app_id</dt>
      <dd className={report.appId === 'set' ? 'text-success' : 'text-error'}>
        {report.appId}
      </dd>
      <dt className="text-text-subtle">app_secret</dt>
      <dd className={report.appSecret === 'set' ? 'text-success' : 'text-error'}>
        {report.appSecret}
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
        The holo Teams bot isn&apos;t configured on this deployment yet. An
        operator must:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-6 text-text">
        <li>
          Register a multi-tenant Azure AD app at{' '}
          <a
            href="https://portal.azure.com"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            portal.azure.com
          </a>{' '}
          → App registrations → New.
        </li>
        <li>
          Create an Azure Bot resource pointing at{' '}
          <InlineCode>{`{GATEWAY}/teams-bot/messages`}</InlineCode>.
        </li>
        <li>
          Set <InlineCode>TEAMS_BOT_APP_ID</InlineCode> (the Microsoft App ID)
          and <InlineCode>TEAMS_BOT_APP_SECRET</InlineCode> on gateway + worker,
          then redeploy.
        </li>
      </ol>
      <p className="text-[12px] text-text-subtle">
        Full guide:{' '}
        <a
          href="https://github.com/maakle/holo/blob/main/docs/connectors/teams-bot.md"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          docs/connectors/teams-bot.md
        </a>
      </p>
    </div>
  );
}

/**
 * The `tenant_unclaimed` state. Surfaces the two-action customer install
 * flow: (1) download the app package, (2) paste the resulting tenant id
 * back to register it. The manifest download is the only Teams-specific
 * step that has no parallel in Slack/Google Chat — those have OAuth /
 * marketplace flows. Teams needs a sideload, which means a zip.
 */
function ClaimTenant({ onClaimed }: { onClaimed: () => void }) {
  const [tenantId, setTenantId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/connectors/teams-bot/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          ...(displayName.trim() ? { tenantDisplayName: displayName.trim() } : {}),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; problem?: string };
      if (res.ok && data.ok) {
        setTenantId('');
        setDisplayName('');
        onClaimed();
        return;
      }
      setErr(data.problem ?? 'Failed to register the tenant.');
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        <div className="space-y-2">
          <div>
            Download the holo app package — a <InlineCode>.zip</InlineCode>{' '}
            containing the manifest and icons. Each download is stamped with a
            stable id for this org so re-downloads update the existing install
            instead of creating duplicates.
          </div>
          <a
            href="/api/connectors/teams-bot/manifest"
            download="holo-bot.zip"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            Download holo-bot.zip
          </a>
        </div>
      </Step>
      <Step n={2}>
        In <strong>Teams Admin Center</strong> → <em>Manage apps</em> →{' '}
        <em>Upload custom app</em>, upload the zip. Approve the app for your
        organization.
      </Step>
      <Step n={3}>
        Add the bot to a team, channel, or DM in the Teams desktop/web client.
        The first activity it receives carries your tenant id.
      </Step>
      <Step n={4}>
        Copy your <strong>Azure AD tenant ID</strong> from{' '}
        <InlineCode>portal.azure.com</InlineCode> → <em>Azure Active Directory</em> →{' '}
        <em>Overview</em> → <em>Tenant ID</em>. It looks like a GUID
        (8-4-4-4-12 hex).
      </Step>
      <Step n={5}>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-[20rem] rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus:border-accent"
              disabled={busy}
            />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tenant display name (optional)"
              className="w-[16rem] rounded-md border border-border bg-surface px-3 py-2 text-xs text-text outline-none focus:border-accent"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || tenantId.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? 'Registering…' : 'Register tenant'}
            </button>
          </div>
          {err && <p className="text-xs text-error">{err}</p>}
        </form>
      </Step>
    </ol>
  );
}

interface Installation {
  tenantId: string;
  tenantDisplayName: string | null;
  installedAt: string;
}

function BotEnabled({
  installationCount,
  onChange,
}: {
  installationCount: number;
  onChange: () => void;
}) {
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [showAddAnother, setShowAddAnother] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/teams-bot/installations')
      .then((res) => res.json())
      .then((data: { installations?: Installation[] }) => {
        if (!cancelled) setInstallations(data.installations ?? []);
      })
      .catch(() => {
        if (!cancelled) setInstallations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlink(tenantId: string) {
    if (
      !confirm(
        `Unlink tenant ${tenantId}? The bot will stop replying in that tenant until re-registered.`,
      )
    ) {
      return;
    }
    await fetch(
      `/api/connectors/teams-bot/claim?tenantId=${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' },
    );
    onChange();
  }

  return (
    <ol className="list-none space-y-4">
      <Step n={1}>
        <span className="text-success">
          ✓ holo Teams bot is active in{' '}
          {installationCount === 1 ? '1 tenant' : `${installationCount} tenants`}.
        </span>
      </Step>
      <Step n={2}>
        Open a DM with the <strong>holo</strong> bot in Teams and ask:{' '}
        <InlineCode>what do we know about onboarding?</InlineCode>
      </Step>
      <Step n={3}>
        Or @mention the bot in any channel:{' '}
        <InlineCode>@holo what shipped last week?</InlineCode> The reply threads
        under your message.
      </Step>
      <Step n={4}>
        {installations === null ? (
          <p className="text-xs text-text-subtle">Loading tenants…</p>
        ) : (
          <ul className="space-y-1.5">
            {installations.map((inst) => (
              <li
                key={inst.tenantId}
                className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2 text-[12px]"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-text">
                    {inst.tenantDisplayName ?? inst.tenantId}
                  </div>
                  <div className="font-mono text-[11px] text-text-subtle">
                    {inst.tenantId}
                  </div>
                </div>
                <button
                  onClick={() => unlink(inst.tenantId)}
                  className="shrink-0 text-text-subtle underline-offset-2 transition-colors hover:text-error hover:underline"
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        )}
      </Step>
      <Step n={5}>
        {showAddAnother ? (
          <ClaimTenant
            onClaimed={() => {
              setShowAddAnother(false);
              onChange();
            }}
          />
        ) : (
          <button
            onClick={() => setShowAddAnother(true)}
            className="text-xs text-text-subtle underline-offset-2 transition-colors hover:text-text hover:underline"
          >
            + Install in another tenant
          </button>
        )}
      </Step>
    </ol>
  );
}
