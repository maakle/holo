'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

interface Args {
  /** Placeholder shown in the token input. */
  placeholder: string;
  /** Inline help / where to find the token. */
  helpText?: string;
  /** Optional URL the "Where do I find this?" link points to. */
  helpUrl?: string;
  /** Bullet points of permissions/effects shown to the user. */
  permissions?: string[];
  /** Numbered setup steps shown above the token input. */
  instructions?: string[];
}

/**
 * Generic step that captures an API key / token and POSTs it to
 * /api/connectors/<provider>/connect. On success → router.refresh + advance.
 */
export function apiKeyStep<TState>(
  ctx: WizardContext<TState>,
  args: Args,
) {
  return <ApiKeyStep ctx={ctx} args={args} />;
}

function ApiKeyStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, connectedAs } = ctx;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? 'Connection failed');
        return;
      }
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
              {args.instructions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : null}
          {args.permissions && args.permissions.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[12px] text-text-muted">
              {args.permissions.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          ) : null}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={args.placeholder}
            className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
            autoComplete="off"
            disabled={busy}
          />
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
            <Button variant="primary" onClick={save} disabled={busy || !token.trim()}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}
