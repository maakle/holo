'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

interface Args {
  /** Scopes to display so admins can paste them into the DWD scope list. */
  scopes: ReadonlyArray<string>;
  /** Provider-specific name for the impersonation field hint. */
  impersonationHint?: string;
}

/**
 * Step that collects a Google service account JSON key + impersonation email
 * and POSTs them to /api/connectors/<provider>/service-account. Used for
 * googledrive and google-chat — those connectors are workspace-scoped via
 * domain-wide delegation rather than per-user OAuth.
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
  const { meta, connected, connectedAs } = ctx;
  const [keyJson, setKeyJson] = useState('');
  const [impersonationEmail, setImpersonationEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!keyJson.trim()) {
      setError('Paste the JSON key downloaded from Google Cloud Console.');
      return;
    }
    if (!isValidEmail(impersonationEmail)) {
      setError('Enter the Workspace email the service account should act as.');
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

  return (
    <>
      {connected ? (
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
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">
            Holo connects to {meta.displayName} via a Google service account
            with domain-wide delegation. One workspace-wide install — no
            per-user OAuth, no token churn when employees leave.
          </p>
          <ol className="flex flex-col gap-1 text-[12px] text-text-muted list-decimal pl-4">
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
              , create a service account (or pick an existing one) and add a
              JSON key (Keys → Add key → Create new key → JSON).
            </li>
            <li>
              Enable domain-wide delegation on the service account, then copy
              its <span className="font-mono">client ID</span>.
            </li>
            <li>
              In{' '}
              <a
                href="https://admin.google.com/ac/owl/domainwidedelegation"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                Workspace Admin Console → Security → API Controls → Domain-wide
                Delegation
              </a>
              , add a new client with the service account&apos;s client ID and
              the scopes shown below.
            </li>
            <li>Paste the full JSON key file and the impersonation email below.</li>
          </ol>

          <ScopeBlock scopes={args.scopes} />

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-subtle">
              Impersonation email
            </span>
            <input
              type="email"
              value={impersonationEmail}
              onChange={(e) => {
                setImpersonationEmail(e.target.value);
                if (error) setError(null);
              }}
              placeholder={args.impersonationHint ?? 'admin@yourcompany.com'}
              className="w-full rounded-md border border-border bg-bg py-2 px-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <span className="text-[11px] text-text-subtle">
              The Workspace user the service account acts as. Holo only sees
              what this user can see — pick someone with broad access.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-subtle">
              Service account JSON key
            </span>
            <textarea
              value={keyJson}
              onChange={(e) => {
                setKeyJson(e.target.value);
                if (error) setError(null);
              }}
              placeholder='{"type": "service_account", "project_id": "...", ...}'
              rows={6}
              className="w-full rounded-md border border-border bg-bg py-2 px-3 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <span className="text-[11px] text-text-subtle">
              Stored encrypted at rest. Holo signs short-lived tokens with
              this key on every sync — it never leaves the server.
            </span>
          </label>

          {error ? <p className="text-[12px] text-error">{error}</p> : null}
        </div>
      )}
      <AlertDialogFooter>
        {connected ? (
          <Button variant="primary" onClick={ctx.goNext}>
            Continue
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={ctx.close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={busy || !keyJson.trim() || !isValidEmail(impersonationEmail)}
            >
              {busy ? 'Validating…' : 'Connect'}
            </Button>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function ScopeBlock({ scopes }: { scopes: ReadonlyArray<string> }) {
  const [copied, setCopied] = useState(false);
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(scopes.join(','));
      setCopied(true);
      toast.success('Scopes copied');
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.04em] text-text-subtle">
          OAuth scopes (paste into DWD)
        </span>
        <button
          type="button"
          onClick={copyAll}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text focus:outline-hidden focus:focus-ring"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" aria-hidden /> Copied
            </>
          ) : (
            'Copy all'
          )}
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {scopes.map((s) => (
          <li key={s} className="font-mono text-[12px] text-text">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
