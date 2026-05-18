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
   * in the DWD setup sub-step so the admin can paste the chat.app.* scopes
   * into Workspace Admin's Domain-wide Delegation field.
   */
  scopes: ReadonlyArray<string>;
}

const SUB_STEPS = [
  { id: 'gcp', label: 'GCP setup' },
  { id: 'dwd', label: 'Grant scopes to the SA' },
  { id: 'paste', label: 'Paste service-account key' },
] as const;

/**
 * Bot-in-space install step for Google Chat. Replaces DWD-impersonation
 * with narrower DWD-with-app-scopes — same admin friction (one DWD entry)
 * but app reads only spaces it's been added to, no user impersonation.
 *
 * Three sub-steps that mirror the admin's context switches:
 *   1. GCP Console: enable Chat API, create SA + download JSON key,
 *      configure the Chat App identity (name/avatar/visibility).
 *   2. Workspace Admin Console: add the SA's client_id to Domain-wide
 *      Delegation with the chat.app.* scopes. The SA still acts as itself
 *      (no `sub` claim — discovered empirically that this is what grants
 *      chat.app.* to SA-based app-auth principals). See
 *      docs/designs/google-chat-bot-in-space-migration.md Phase 0 notes.
 *   3. Holo: paste the SA JSON key. We POST with authMode='app' so the
 *      token-loader skips impersonation and mints app-level tokens.
 *
 * Why no Marketplace SDK setup here: empirically verified that DWD-with-
 * app-scopes alone is sufficient for BYO installs. Marketplace SDK is only
 * needed for the future "published Holo app" path (one-click install for
 * SaaS customers, requires Google review — separate workstream).
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
          scopes once via Domain-wide Delegation; the bot then reads only
          spaces it&apos;s been explicitly added to. No user impersonation.
        </p>

        <SubStepIndicator current={subStep} />

        {subStep === 0 ? (
          <GcpSetupBody />
        ) : subStep === 1 ? (
          <DwdSetupBody scopes={args.scopes} />
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

function GcpSetupBody() {
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
        key — keep it for the final step. Note the SA&apos;s{' '}
        <span className="font-mono">client ID</span> (21-digit number on the
        Details tab) — you&apos;ll need it in step 2.
      </li>
      <li>
        In{' '}
        <a
          href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          Chat API → Configuration
        </a>
        , set <span className="font-medium text-text">App name</span> = Holo,
        upload an avatar, set Visibility = &ldquo;Specific people / groups
        in your domain&rdquo;, and enter your admin email. Make sure{' '}
        <span className="font-medium text-text">Gruppenbereichen beitreten</span>{' '}
        is enabled so users can add the bot to spaces via{' '}
        <code className="font-mono">@Holo</code>.
      </li>
      <li>
        Add the Holo bot to the Chat spaces you want indexed via{' '}
        <code className="font-mono">@Holo</code> in each space, or have space
        owners add it. The bot reads only the spaces it&apos;s a member of.
      </li>
    </ol>
  );
}

function DwdSetupBody({ scopes }: { scopes: ReadonlyArray<string> }) {
  // chat.bot doesn't need DWD — it's project-implicit. Only the chat.app.*
  // scopes need to be on the SA's DWD list. Empirically verified on
  // 2026-05-18: this step alone is sufficient for SA-based app-auth to
  // read chat.app.* APIs (no Marketplace SDK install needed for the BYO
  // path). The SA still acts as itself (no `sub` claim) — DWD here just
  // grants the scopes to the SA principal.
  const appScopes = scopes.filter((s) => s.includes('chat.app.'));
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning,#d97706)_8%,transparent)] px-3 py-2 text-[12px] text-text-muted">
        <span className="font-medium text-text">Why this step is required:</span>{' '}
        Google&apos;s <code className="font-mono">chat.app.*</code> scopes are
        admin-approval-required. For service-account app-auth (what Holo uses
        for ingestion), the grant happens by listing the SA&apos;s client_id
        here with the scopes. The SA still acts as itself — this isn&apos;t
        classic user-impersonation DWD; reads are scoped to spaces the bot
        was added to.
      </div>
      <ol className="flex flex-col gap-3 text-[12px] text-text-muted list-decimal pl-4">
        <li>
          Open{' '}
          <a
            href="https://admin.google.com/ac/owl/domainwidedelegation"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            Workspace Admin Console → Security → API Controls → Domain-wide Delegation
          </a>{' '}
          and click <span className="font-medium text-text">Add new</span>.
        </li>
        <li>
          Paste the service account&apos;s{' '}
          <span className="font-mono">client ID</span> from step 1.
        </li>
        <li className="flex flex-col gap-2">
          <span>
            Paste the scopes below into the OAuth scopes field, then{' '}
            <span className="font-medium text-text">Authorize</span>.
          </span>
          <ScopeBlock scopes={appScopes} />
        </li>
        <li>
          DWD typically propagates in &lt;60 seconds. After this step the
          install&apos;s &ldquo;Connect&rdquo; click can validate the bot can
          actually read messages.
        </li>
      </ol>
    </div>
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
