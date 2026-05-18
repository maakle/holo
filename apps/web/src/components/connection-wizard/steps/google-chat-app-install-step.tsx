'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

interface Args {
  /**
   * App-auth scopes the SA needs (chat.bot + the three chat.app.*). Rendered
   * in the Marketplace SDK setup sub-step so the admin can paste them into
   * the SDK's OAuth-Bereiche field.
   */
  scopes: ReadonlyArray<string>;
}

const SUB_STEPS = [
  { id: 'marketplace', label: 'Marketplace SDK setup' },
  { id: 'install', label: 'Admin install + scope grant' },
  { id: 'paste', label: 'Paste service-account key' },
] as const;

/**
 * Bot-in-space install step for Google Chat. Replaces the DWD-impersonation
 * setup with the Marketplace SDK + admin OAuth grant path — narrower trust
 * (chat.app.* scopes only, no user impersonation), one-click install.
 *
 * Three sub-steps that mirror the admin's context switches:
 *   1. GCP Console: configure Workspace Marketplace SDK (private listing,
 *      Chat app integration, OAuth-Bereiche with chat.app.* scopes).
 *   2. Admin Console: install the (now-published) private app for the
 *      domain — Google's install dialog surfaces the chat.app.* scopes for
 *      explicit approval here.
 *   3. Holo: paste the SA JSON key. We POST with authMode='app' so the
 *      token-loader skips impersonation and mints app-level tokens.
 *
 * Why no impersonation email here: app-mode authenticates the SA as itself
 * (no `sub` claim in the JWT). Reads are scoped to spaces where the Holo
 * Chat App is a member.
 */
export function googleChatAppInstallStep<TState>(
  ctx: WizardContext<TState>,
  args: Args,
) {
  return <GoogleChatAppInstallStep ctx={ctx} args={args} />;
}

function GoogleChatAppInstallStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, connectedAs, forceCredentialEntry } = ctx;
  const showConnectedBanner = connected && !forceCredentialEntry;
  const [keyJson, setKeyJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subStep, setSubStep] = useState(0);

  async function save() {
    if (!keyJson.trim()) {
      setError('Paste the JSON key downloaded from Google Cloud Console.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/service-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyJson: keyJson.trim(),
          authMode: 'app',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? 'Connection failed');
        return;
      }
      toast.success(`${meta.displayName} connected (bot-in-space mode)`);
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  if (showConnectedBanner) {
    return (
      <>
        <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" aria-hidden />
            <span className="font-medium">{meta.displayName} connected</span>
          </div>
          {connectedAs ? (
            <p className="mt-1 text-text-muted">
              Connected to <span className="font-medium text-text">{connectedAs}</span>.
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <Button variant="primary" onClick={ctx.goNext}>
            Continue
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  const isLast = subStep === SUB_STEPS.length - 1;

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-muted">
          Holo joins your Google Chat as a workspace app. Admin grants{' '}
          <code className="font-mono text-[12px] text-text">chat.app.*</code>{' '}
          scopes once via Marketplace install; the bot then reads only spaces
          it&apos;s been explicitly added to. No user impersonation.
        </p>

        <SubStepIndicator current={subStep} />

        {subStep === 0 ? (
          <MarketplaceSdkBody scopes={args.scopes} />
        ) : subStep === 1 ? (
          <AdminInstallBody />
        ) : (
          <PasteCredentialsBody
            keyJson={keyJson}
            setKeyJson={(v) => {
              setKeyJson(v);
              if (error) setError(null);
            }}
            busy={busy}
          />
        )}

        {error && isLast ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>

      <AlertDialogFooter>
        {subStep === 0 ? (
          <Button variant="secondary" onClick={ctx.close} disabled={busy}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setSubStep((s) => Math.max(0, s - 1))}
            disabled={busy}
          >
            Back
          </Button>
        )}
        {isLast ? (
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || !keyJson.trim()}
          >
            {busy ? 'Validating…' : 'Connect'}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => setSubStep((s) => Math.min(SUB_STEPS.length - 1, s + 1))}
          >
            Next
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}

function SubStepIndicator({ current }: { current: number }) {
  const label = SUB_STEPS[current]?.label ?? '';
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-subtle">
      <div className="flex items-center gap-1.5" aria-hidden>
        {SUB_STEPS.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 w-1.5 rounded-full ${
              i === current
                ? 'bg-accent'
                : i < current
                  ? 'bg-success'
                  : 'bg-border-strong'
            }`}
          />
        ))}
      </div>
      <span className="uppercase tracking-[0.04em]">
        Step {current + 1} of {SUB_STEPS.length} · {label}
      </span>
    </div>
  );
}

function MarketplaceSdkBody({ scopes }: { scopes: ReadonlyArray<string> }) {
  // chat.bot is granted automatically; the three chat.app.* scopes are what
  // admins must explicitly add to the Marketplace SDK's OAuth-Bereiche field.
  const appScopes = scopes.filter((s) => s.includes('chat.app.'));
  return (
    <ol className="flex flex-col gap-3 text-[12px] text-text-muted list-decimal pl-4">
      <li>
        Enable the{' '}
        <a
          href="https://console.cloud.google.com/apis/library/chat.googleapis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          Google Chat API
        </a>{' '}
        and the{' '}
        <a
          href="https://console.cloud.google.com/apis/library/appsmarket-component.googleapis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          Google Workspace Marketplace SDK
        </a>{' '}
        in your GCP project.
      </li>
      <li>
        In{' '}
        <a
          href="https://console.cloud.google.com/iam-admin/serviceaccounts"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          IAM → Service Accounts
        </a>
        , create a service account (no IAM role needed) and download a JSON
        key — keep it for the final step.
      </li>
      <li className="flex flex-col gap-2">
        <span>
          Open the{' '}
          <a
            href="https://console.cloud.google.com/apis/api/appsmarket-component.googleapis.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            Marketplace SDK
          </a>{' '}
          → <span className="font-medium text-text">Anwendungskonfiguration</span> tab.
          Set Visibility = <span className="font-medium text-text">Private</span>{' '}
          (irreversible — choose carefully). Check{' '}
          <span className="font-medium text-text">Chat-App</span>. Under{' '}
          <span className="font-medium text-text">OAuth-Bereiche</span>, add the
          three app-auth scopes below alongside the existing defaults.
        </span>
        <ScopeBlock scopes={appScopes} />
        <span className="text-[11px] text-text-subtle">
          (These three only — <code className="font-mono">chat.bot</code> is
          granted to your project automatically.)
        </span>
      </li>
      <li>
        In the{' '}
        <span className="font-medium text-text">Store-Eintrag</span> tab, fill
        in the required fields (name, icon, descriptions, privacy + terms
        URLs) and publish. Private listings skip Google&apos;s public review.
      </li>
    </ol>
  );
}

function AdminInstallBody() {
  return (
    <ol className="flex flex-col gap-3 text-[12px] text-text-muted list-decimal pl-4">
      <li>
        Go to{' '}
        <a
          href="https://admin.google.com/ac/apps/gsuiteapps"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          Workspace Admin Console → Apps → Google Workspace Marketplace apps
        </a>
        .
      </li>
      <li>
        Click <span className="font-medium text-text">App installieren</span>{' '}
        (top right) → switch to the{' '}
        <span className="font-medium text-text">Interne Apps</span> filter →
        find your private listing.
      </li>
      <li>
        Install for{' '}
        <span className="font-medium text-text">your entire organisation</span>
        . Google&apos;s install dialog surfaces the three{' '}
        <code className="font-mono">chat.app.*</code> scopes — approve them.
      </li>
      <li>
        Add the Holo bot to the Chat spaces you want indexed via{' '}
        <code className="font-mono">@Holo</code> in each space, or have space
        owners add it. The bot can read history once it&apos;s a member.
      </li>
    </ol>
  );
}

function PasteCredentialsBody({
  keyJson,
  setKeyJson,
  busy,
}: {
  keyJson: string;
  setKeyJson: (v: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-text-muted">
        Final step — paste the service-account JSON key from step 2 of the
        Marketplace SDK setup. No impersonation email needed: app-mode
        authenticates the SA as itself.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-text-subtle">
          Service account JSON key
        </span>
        <textarea
          value={keyJson}
          onChange={(e) => setKeyJson(e.target.value)}
          placeholder='{"type": "service_account", "project_id": "...", ...}'
          rows={6}
          className="w-full rounded-md border border-border bg-bg py-2 px-3 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <span className="text-[11px] text-text-subtle">
          Stored encrypted at rest. Holo signs short-lived tokens with this
          key — it never leaves the server. The bot then acts as itself
          (no user impersonation) for{' '}
          <code className="font-mono">chat.app.*</code> reads.
        </span>
      </label>
    </div>
  );
}

function ScopeBlock({ scopes }: { scopes: ReadonlyArray<string> }) {
  const [copied, setCopied] = useState(false);
  const joined = scopes.join('\n');
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(joined);
      setCopied(true);
      toast.success('Scopes copied');
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.04em] text-text-subtle">
          App-auth scopes (paste into Marketplace SDK)
        </span>
        <button
          type="button"
          onClick={copyAll}
          className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text focus:outline-hidden focus:focus-ring"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden /> Copy
            </>
          )}
        </button>
      </div>
      <code className="block whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-text">
        {joined}
      </code>
    </div>
  );
}
