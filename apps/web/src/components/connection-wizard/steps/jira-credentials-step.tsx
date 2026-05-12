'use client';
import { useState } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

interface Args {
  helpText?: string;
  helpUrl?: string;
  instructions?: string[];
}

function validateAtlassianSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'Site URL is required.';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return 'Enter a valid URL (e.g. https://yourcompany.atlassian.net).';
  }
  if (!parsed.host.toLowerCase().endsWith('.atlassian.net')) {
    return 'Site URL must be an Atlassian Cloud host (…atlassian.net). Server / Data Center are not supported.';
  }
  return null;
}

export function jiraCredentialsStep<TState>(
  ctx: WizardContext<TState>,
  args: Args = {},
) {
  return <JiraCredentialsStep ctx={ctx} args={args} />;
}

function JiraCredentialsStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, connectedAs, forceCredentialEntry } = ctx;
  const showConnectedBanner = connected && !forceCredentialEntry;
  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (siteUrl.trim().length === 0 || email.trim().length === 0 || token.trim().length === 0) {
      setError('Site URL, email, and API token are all required.');
      return;
    }
    const urlError = validateAtlassianSiteUrl(siteUrl);
    if (urlError) {
      setError(urlError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl, email, token }),
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
      {showConnectedBanner ? (
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
          {args.helpText ? (
            <p className="text-[13px] text-text-muted">
              {args.helpText}
              {args.helpUrl ? (
                <>
                  {' '}
                  <a
                    href={args.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Where do I find this? →
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {args.instructions && args.instructions.length > 0 ? (
            <ol className="flex flex-col gap-1 text-[12px] text-text-muted list-decimal pl-4">
              {args.instructions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-muted">Site URL</span>
            <input
              type="text"
              inputMode="url"
              placeholder="https://yourcompany.atlassian.net"
              value={siteUrl}
              onChange={(e) => {
                setSiteUrl(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-muted">Atlassian email</span>
            <input
              type="email"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
              autoComplete="off"
              disabled={busy}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-muted">API token</span>
            <div className="relative">
              <input
                type={revealed ? 'text' : 'password'}
                placeholder={`${meta.displayName} API token`}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-9 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
                autoComplete="off"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                disabled={busy}
                aria-label={revealed ? 'Hide token' : 'Show token'}
                aria-pressed={revealed}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-text-subtle hover:text-text focus:outline-hidden focus:focus-ring disabled:opacity-50"
              >
                {revealed ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </div>
          </label>

          {error ? <p className="text-[12px] text-error">{error}</p> : null}
        </div>
      )}
      <AlertDialogFooter>
        {showConnectedBanner ? (
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
              disabled={busy || !siteUrl.trim() || !email.trim() || !token.trim()}
            >
              {busy ? 'Connecting…' : `Connect ${meta.displayName}`}
            </Button>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}
