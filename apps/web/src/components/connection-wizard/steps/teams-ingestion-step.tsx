'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

type TeamsStatus =
  | 'loading'
  | 'not_configured'
  | 'bot_not_installed'
  | 'ready_to_enable'
  | 'enabled'
  | 'error';

interface StatusResponse {
  status?: TeamsStatus;
  installationCount?: number;
}

/**
 * The Teams ingestion connector has no per-org credentials — auth lives
 * in env (`TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_SECRET`). The wizard step
 * is state-aware:
 *
 *   - `not_configured`     → operator runbook + docs link, no Enable CTA
 *   - `bot_not_installed`  → "Install the @holo bot first" + link to the
 *                            Microsoft Teams *bot* connect flow
 *   - `ready_to_enable`    → "Enable ingestion" button
 *   - `enabled`            → success state + tenant count
 *
 * Unlike the api-key step, no input field — the only user action is
 * clicking Enable, which calls `POST /api/connectors/teams/connect`
 * and advances the wizard.
 */
export function teamsIngestionStep<TState>(ctx: WizardContext<TState>) {
  return <TeamsIngestionStep ctx={ctx} />;
}

function TeamsIngestionStep<TState>({ ctx }: { ctx: WizardContext<TState> }) {
  const [status, setStatus] = useState<TeamsStatus>('loading');
  const [installCount, setInstallCount] = useState(0);
  const [enabling, setEnabling] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/teams/status')
      .then((res) => res.json())
      .then((data: StatusResponse) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
        setInstallCount(data.installationCount ?? 0);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  async function enable() {
    setEnabling(true);
    try {
      const res = await fetch('/api/connectors/teams/connect', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; problem?: string; fix?: string };
      if (res.ok && data.ok) {
        toast.success('Teams ingestion enabled — first sync queued.');
        ctx.refreshServer();
        ctx.goNext();
        return;
      }
      toast.error(data.problem ?? 'Failed to enable ingestion.', {
        description: data.fix,
      });
      setTick((t) => t + 1);
    } catch (e) {
      toast.error('Network error.');
      console.error(e);
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-[13px] leading-6 text-text">
        <p>
          Index channel and chat history from Microsoft Teams resources where
          the @holo bot is installed. The bot grants Microsoft Graph access
          via Resource-Specific Consent — Microsoft enforces the boundary,
          so this connector can only read messages from places the bot was
          explicitly added.
        </p>
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-text-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking status…
        </div>
      )}

      {status === 'not_configured' && <NotConfiguredCard />}
      {status === 'bot_not_installed' && <BotNotInstalledCard onRefresh={() => setTick((t) => t + 1)} />}
      {status === 'ready_to_enable' && (
        <ReadyToEnableCard installCount={installCount} />
      )}
      {status === 'enabled' && <EnabledCard installCount={installCount} />}

      {status === 'error' && (
        <p className="text-xs text-error">
          Couldn&apos;t check status. Refresh and try again.
        </p>
      )}

      <AlertDialogFooter>
        {status === 'ready_to_enable' && (
          <Button onClick={enable} disabled={enabling}>
            {enabling ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Enabling…
              </>
            ) : (
              'Enable ingestion'
            )}
          </Button>
        )}
        {status === 'enabled' && (
          <Button onClick={() => ctx.goNext()}>Continue</Button>
        )}
        {(status === 'not_configured' ||
          status === 'bot_not_installed' ||
          status === 'error') && (
          <Button variant="outline" onClick={() => ctx.close()}>
            Close
          </Button>
        )}
      </AlertDialogFooter>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-4">
      <p className="text-[13px] leading-6 text-text">
        The Teams bot isn&apos;t configured on this deployment yet. An
        operator must register an Azure AD app + Azure Bot resource and set{' '}
        <code>TEAMS_BOT_APP_ID</code> / <code>TEAMS_BOT_APP_SECRET</code> on
        the worker before ingestion can run.
      </p>
      <a
        href="https://github.com/maakle/holo/blob/main/docs/connectors/teams-bot.md"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
      >
        docs/connectors/teams-bot.md <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function BotNotInstalledCard({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-4">
      <p className="text-[13px] leading-6 text-text">
        The @holo bot isn&apos;t installed in any Azure AD tenant for this
        org yet. Ingestion can only read from channels and chats where the
        bot has been added.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-5 text-text-subtle">
        <li>
          Go to <strong>Connect</strong> → <strong>Microsoft Teams</strong>{' '}
          (under Chat bot) and download <code>holo-bot.zip</code>.
        </li>
        <li>
          Sideload the zip in <strong>Teams Admin Center</strong> →{' '}
          <em>Manage apps</em> → <em>Upload custom app</em>.
        </li>
        <li>
          Add the bot to a team, channel, or DM, then paste the tenant ID
          back on the bot connect page.
        </li>
        <li>Return here and click Refresh.</li>
      </ol>
      <Button size="sm" variant="outline" onClick={onRefresh}>
        Refresh status
      </Button>
    </div>
  );
}

function ReadyToEnableCard({ installCount }: { installCount: number }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-4">
      <p className="text-[13px] leading-6 text-text">
        Bot is installed in{' '}
        <strong>
          {installCount === 1 ? '1 tenant' : `${installCount} tenants`}
        </strong>
        . Click <em>Enable ingestion</em> below to start indexing channel
        and chat history. The first sync is queued immediately; subsequent
        syncs run every 6 hours.
      </p>
      <p className="text-[12px] leading-5 text-text-subtle">
        Channels and chats discovered will respect Microsoft&apos;s
        Resource-Specific Consent boundary — only resources where the bot
        is installed are read.
      </p>
    </div>
  );
}

function EnabledCard({ installCount }: { installCount: number }) {
  return (
    <div className="space-y-2 rounded-md border border-success/40 bg-success/10 p-4">
      <p className="text-[13px] leading-6 text-text">
        ✓ Teams ingestion is active across{' '}
        <strong>
          {installCount === 1 ? '1 tenant' : `${installCount} tenants`}
        </strong>
        . The scheduler runs every 6 hours; new threads land in your corpus
        on the next run.
      </p>
    </div>
  );
}
