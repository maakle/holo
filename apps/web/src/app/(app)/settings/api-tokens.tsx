'use client';

import { useEffect, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ApiToken = {
  id: string;
  prefix: string | null;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiToken | null>(null);
  const [, startDelete] = useTransition();

  async function load() {
    try {
      const res = await fetch('/api/tokens');
      if (!res.ok) {
        setLoadError('Could not load tokens.');
        setTokens([]);
        return;
      }
      const data = (await res.json()) as { tokens: ApiToken[] };
      setTokens(data.tokens);
      setLoadError(null);
    } catch {
      setLoadError('Could not load tokens.');
      setTokens([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'agent' }),
      });
      const data = (await res.json()) as { token?: string; problem?: string };
      if (res.ok && data.token) {
        setNewToken(data.token);
        await load();
      } else {
        setGenError(data.problem ?? 'Failed to generate token.');
      }
    } catch {
      setGenError('Network error.');
    } finally {
      setGenerating(false);
    }
  }

  function revoke(token: ApiToken) {
    startDelete(async () => {
      try {
        const res = await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(data.problem ?? 'Could not revoke token.');
          return;
        }
        toast.success('Token revoked.');
        setPendingDelete(null);
        await load();
      } catch {
        toast.error('Network error.');
      }
    });
  }

  function copyNewToken() {
    if (!newToken) return;
    navigator.clipboard
      .writeText(newToken)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => {});
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[15px] font-medium">API keys</h2>
          <p className="text-[13px] leading-5 text-text-muted">
            Bearer tokens used by agents to authenticate against the MCP gateway.
            Keys are shown once at creation — store them somewhere safe.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={generate}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Generate API key'}
        </Button>
      </div>

      {genError ? <p className="text-[12px] text-error">{genError}</p> : null}

      {newToken ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 space-y-2">
          <p className="text-[12px] font-medium text-warning">
            Save this key now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-[12px] text-text">
              {newToken}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={copyNewToken}>
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNewToken(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {tokens === null ? (
          <div className="px-4 py-3 text-[13px] text-text-subtle">Loading…</div>
        ) : tokens.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-text-subtle">
            {loadError ?? 'No API keys yet. Generate one to connect an agent.'}
          </div>
        ) : (
          <ul>
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[13px] text-text">
                      {t.prefix ? `${t.prefix}…` : 'holo_••••••••'}
                    </code>
                    <span className="text-[12px] text-text-subtle">{t.label}</span>
                  </div>
                  <div className="text-[12px] text-text-subtle">
                    Created {formatDate(t.createdAt)} ·{' '}
                    {t.lastUsedAt
                      ? `last used ${formatDate(t.lastUsedAt)}`
                      : 'never used'}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Revoke token"
                  onClick={() => setPendingDelete(t)}
                  className="rounded-sm p-1.5 text-text-subtle transition-colors duration-micro ease-enter hover:text-error focus-visible:outline-hidden focus-visible:focus-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any agent or client using{' '}
              <span className="font-mono text-text">
                {pendingDelete?.prefix ?? 'this key'}
                {pendingDelete?.prefix ? '…' : ''}
              </span>{' '}
              will immediately fail to authenticate. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              destructive
              onClick={() => pendingDelete && revoke(pendingDelete)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
