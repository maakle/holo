'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { openOAuthPopup } from '@/lib/oauth-popup';
import type { WizardContext } from '../types';

interface Args {
  /** Bullet points of permissions/effects shown to the user. */
  permissions?: string[];
  /** Label for the install/connect CTA button. */
  installButtonLabel?: string;
}

/**
 * Generic step that installs / authorizes an OAuth connector via popup.
 * On success → router.refresh() + advance. On user-dismissed popup → stay
 * on the step. Errors are surfaced inline.
 */
export function oauthInstallStep<TState>(
  ctx: WizardContext<TState>,
  args: Args,
) {
  return <OAuthInstallStep ctx={ctx} args={args} />;
}

function OAuthInstallStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, connectedAs } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/initiate`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        fix?: string;
        problem?: string;
      };
      if (!res.ok || !body.authorizeUrl) {
        setError(body.fix ?? body.problem ?? `HTTP ${res.status}`);
        return;
      }
      const result = await openOAuthPopup(body.authorizeUrl, meta.id);
      if (result.status === 'error') {
        setError(result.fix ?? `Install failed${result.code ? ` (${result.code})` : ''}`);
        return;
      }
      if (result.status === 'closed') {
        // User dismissed without completing OAuth — stay put.
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
            We&apos;ll open {meta.displayName} in a popup. Approve the permissions and you&apos;ll
            come straight back here.
          </p>
          {args.permissions && args.permissions.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[12px] text-text-muted">
              {args.permissions.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          ) : null}
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
            <Button variant="primary" onClick={install} disabled={busy}>
              {busy
                ? `Opening ${meta.displayName}…`
                : (args.installButtonLabel ?? `Install ${meta.displayName}`)}
            </Button>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}
