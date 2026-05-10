'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ConnectorMeta } from '@/lib/connector-registry';
import type { WizardContext } from '../types';

interface Args {
  /** Scopes to display so admins can paste them into the DWD scope list. */
  scopes: ReadonlyArray<string>;
  /** Provider-specific name for the impersonation field hint. */
  impersonationHint?: string;
  /**
   * Google API the user must enable in their GCP project before the first
   * sync will succeed. Skipping this is the most common cause of a 403 on
   * the first sync ("API has not been used in project … or it is disabled").
   */
  apiToEnable?: {
    /** Display label, e.g. "Google Chat API". */
    label: string;
    /** API host, e.g. "chat.googleapis.com" — used for the console URL. */
    host: string;
  };
  /**
   * Provider-specific setup steps that aren't covered by the generic
   * service-account flow — e.g. Google Chat's "configure a Chat app" page,
   * which is required even after the Chat API is enabled. Rendered as part
   * of the Google Cloud setup sub-step.
   */
  extraSteps?: ReadonlyArray<{
    /** Headline link text. */
    label: string;
    /** URL the label points to. */
    href: string;
    /** One-line explanation of *why* this step is needed. */
    body: string;
  }>;
}

const SUB_STEPS = [
  { id: 'gcp', label: 'Google Cloud setup' },
  { id: 'dwd', label: 'Domain-wide delegation' },
  { id: 'paste', label: 'Paste credentials' },
] as const;

/**
 * Step that collects a Google service account JSON key + impersonation email
 * and POSTs them to /api/connectors/<provider>/service-account. Used for
 * googledrive and google-chat — those connectors are workspace-scoped via
 * domain-wide delegation rather than per-user OAuth.
 *
 * Internally paginated into three sub-steps that mirror the context
 * switches the admin makes anyway: (1) Google Cloud Console work, (2)
 * Workspace Admin Console DWD config, (3) back in Holo to paste the key.
 * Keeping these as sub-steps (rather than top-level wizard steps) means
 * the connected-state banner + Continue → firstSync still works without
 * forcing the user through three "Continue" clicks.
 */
export function serviceAccountStep<TState>(
  ctx: WizardContext<TState>,
  args: Args,
) {
  return <ServiceAccountStep ctx={ctx} args={args} />;
}

function ServiceAccountStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, connectedAs, forceCredentialEntry } = ctx;
  // In reconnect mode (triggered from the manage sheet) we always show the
  // credential form, even when the row is already connected — that's the
  // whole point of "Reconnect": rotate the key or change the impersonation
  // email without disconnecting first.
  const showConnectedBanner = connected && !forceCredentialEntry;
  const [keyJson, setKeyJson] = useState('');
  const [impersonationEmail, setImpersonationEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subStep, setSubStep] = useState(0);

  async function save() {
    if (!keyJson.trim()) {
      setError('Paste the JSON key downloaded from Google Cloud Console.');
      return;
    }
    if (!isValidEmail(impersonationEmail)) {
      setError('Enter the Workspace email the service account should act as.');
      return;
    }
    // The impersonation email must be a real Workspace user, not the
    // service account itself. Google silently hands back an SA-only token
    // when you "impersonate" the SA, which leaves API calls running as the
    // bot — spaces.list / drives.list then return nothing visible, which
    // is genuinely confusing to debug. Catch the obvious shape here.
    if (impersonationEmail.trim().toLowerCase().endsWith('.iam.gserviceaccount.com')) {
      setError(
        'Use a real Workspace user (e.g. you, or admin@yourcompany.com) — not the service account\'s own email. The service account impersonates that user; everything Holo sees is filtered by what they can see.',
      );
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
          impersonationEmail: impersonationEmail.trim().toLowerCase(),
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
      toast.success(`${meta.displayName} connected`);
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
          Holo connects to {meta.displayName} via a Google service account
          with domain-wide delegation. One workspace-wide install — no
          per-user OAuth, no token churn when employees leave.
        </p>

        <SubStepIndicator current={subStep} />

        {subStep === 0 ? (
          <GcpSetupBody meta={meta} args={args} />
        ) : subStep === 1 ? (
          <DwdSetupBody scopes={args.scopes} />
        ) : (
          <PasteCredentialsBody
            args={args}
            keyJson={keyJson}
            setKeyJson={(v) => {
              setKeyJson(v);
              if (error) setError(null);
            }}
            impersonationEmail={impersonationEmail}
            setImpersonationEmail={(v) => {
              setImpersonationEmail(v);
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
            disabled={busy || !keyJson.trim() || !isValidEmail(impersonationEmail)}
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

function GcpSetupBody({
  meta,
  args,
}: {
  meta: ConnectorMeta;
  args: Args;
}) {
  return (
    <ol className="flex flex-col gap-3 text-[12px] text-text-muted list-decimal pl-4">
      {args.apiToEnable ? (
        <li>
          Enable the{' '}
          <a
            href={`https://console.cloud.google.com/apis/library/${args.apiToEnable.host}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {args.apiToEnable.label}
          </a>{' '}
          in the GCP project you&apos;ll use. Without this, the first sync
          403s with &ldquo;API has not been used in project … or it is
          disabled.&rdquo;
        </li>
      ) : null}
      {args.extraSteps?.map((step) => (
        <li key={step.href}>
          <a
            href={step.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {step.label}
          </a>
          . {step.body}
        </li>
      ))}
      <li>
        In{' '}
        <a
          href="https://console.cloud.google.com/iam-admin/serviceaccounts"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          Google Cloud Console → IAM → Service Accounts
        </a>
        , create a service account (or pick an existing one). You can skip
        the optional &ldquo;Grant this service account access&rdquo; (IAM
        roles) step — {meta.displayName} doesn&apos;t need any project-level
        role.
      </li>
      <li>
        Open the service account, go to the{' '}
        <span className="font-medium text-text">Keys</span> tab, then{' '}
        <span className="font-medium text-text">Add key → Create new key → JSON</span>
        . Google downloads the file once — keep it handy, you&apos;ll paste it
        in the final step.
      </li>
      <li>
        Back on the service account&apos;s{' '}
        <span className="font-medium text-text">Details</span> tab, enable
        domain-wide delegation, then copy its{' '}
        <span className="font-mono">client ID</span>. (DWD is what actually
        grants Workspace data access — not the IAM role above.)
      </li>
    </ol>
  );
}

function DwdSetupBody({ scopes }: { scopes: ReadonlyArray<string> }) {
  return (
    <ol className="flex flex-col gap-3 text-[12px] text-text-muted list-decimal pl-4">
      <li className="flex flex-col gap-2">
        <span>
          Open{' '}
          <a
            href="https://admin.google.com/ac/owl/domainwidedelegation"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            Workspace Admin Console → Security → API Controls → Domain-wide
            Delegation
          </a>{' '}
          and click{' '}
          <span className="font-medium text-text">Add new</span>.
        </span>
      </li>
      <li>
        Paste the service account&apos;s{' '}
        <span className="font-mono">client ID</span> (copied at the end of
        the previous step) into the Client ID field.
      </li>
      <li className="flex flex-col gap-2">
        <span>
          Paste the scopes below into the OAuth scopes field, then{' '}
          <span className="font-medium text-text">Authorize</span>.
        </span>
        <ScopeBlock scopes={scopes} />
      </li>
    </ol>
  );
}

function PasteCredentialsBody({
  args,
  keyJson,
  setKeyJson,
  impersonationEmail,
  setImpersonationEmail,
  busy,
}: {
  args: Args;
  keyJson: string;
  setKeyJson: (v: string) => void;
  impersonationEmail: string;
  setImpersonationEmail: (v: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-text-muted">
        Final step — paste the JSON key file you downloaded and the
        Workspace email the service account should impersonate.
      </p>

      <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
        <span className="font-medium text-text">Recommended:</span> a
        dedicated user like{' '}
        <span className="font-mono text-text">holo@yourcompany.com</span> —
        invite it to the spaces / folders to index. Your own account works
        for testing.
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-text-subtle">
          Impersonation email
        </span>
        <input
          type="email"
          value={impersonationEmail}
          onChange={(e) => setImpersonationEmail(e.target.value)}
          placeholder={args.impersonationHint ?? 'holo@yourcompany.com'}
          className="w-full rounded-md border border-border bg-bg py-2 px-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <span className="text-[11px] text-text-subtle">
          A real Workspace user —
          <strong className="font-medium text-text"> not</strong> the
          service account&apos;s own email. The SA impersonates this user;
          Holo only sees what they can see.
        </span>
      </label>

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
          key on every sync — it never leaves the server.
        </span>
      </label>
    </div>
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function ScopeBlock({ scopes }: { scopes: ReadonlyArray<string> }) {
  const [copied, setCopied] = useState(false);
  const joined = scopes.join(',');
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
          OAuth scopes (paste into DWD)
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
            'Copy'
          )}
        </button>
      </div>
      <code className="block break-all font-mono text-[12px] leading-relaxed text-text">
        {joined}
      </code>
    </div>
  );
}
