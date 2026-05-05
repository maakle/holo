'use client';
import { useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
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
  /** Code-styled scope strings rendered for click-to-select copy. */
  scopes?: { required: string[]; optional?: string[] };
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
  const [revealed, setRevealed] = useState(false);

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
          {args.scopes && args.scopes.required.length > 0 ? (
            <ScopeList required={args.scopes.required} optional={args.scopes.optional} />
          ) : null}
          <div className="relative">
            <input
              type={revealed ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={args.placeholder}
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

function ScopeList({
  required,
  optional,
}: {
  required: string[];
  optional?: string[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      // clipboard unavailable; user can still triple-click to select.
    }
  }

  async function copyAll() {
    const all = [...required, ...(optional ?? [])].join(' ');
    try {
      await navigator.clipboard.writeText(all);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.04em] text-text-subtle">
          Scopes
        </span>
        <button
          type="button"
          onClick={copyAll}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text focus:outline-hidden focus:focus-ring"
        >
          {allCopied ? (
            <>
              <Check className="h-3 w-3 text-success" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden /> Copy all
            </>
          )}
        </button>
      </div>
      <ScopeBlock label="Required" items={required} copied={copied} onCopy={copy} />
      {optional && optional.length > 0 ? (
        <ScopeBlock
          label="Optional (granular engagement scopes — add if your portal lists them)"
          items={optional}
          copied={copied}
          onCopy={copy}
        />
      ) : null}
    </div>
  );
}

function ScopeBlock({
  label,
  items,
  copied,
  onCopy,
}: {
  label: string;
  items: string[];
  copied: string | null;
  onCopy: (value: string, key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-subtle">{label}</span>
      <ul className="flex flex-col gap-0.5">
        {items.map((scope) => (
          <li
            key={scope}
            className="group flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 hover:bg-surface"
          >
            <code className="font-mono text-[12px] text-text">{scope}</code>
            <button
              type="button"
              onClick={() => onCopy(scope, scope)}
              aria-label={`Copy ${scope}`}
              className="flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] text-text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-text focus:opacity-100 focus:outline-hidden focus:focus-ring"
            >
              {copied === scope ? (
                <Check className="h-3 w-3 text-success" aria-hidden />
              ) : (
                <Copy className="h-3 w-3" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
