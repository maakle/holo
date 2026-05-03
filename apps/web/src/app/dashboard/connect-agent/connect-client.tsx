'use client';

import { useActionState, useState, useEffect } from 'react';
import { createToken, type CreateTokenResult } from './actions';
import { ConfigBlocks } from './config-blocks';

export function ConnectClient({ mcpUrl, restUrl }: { mcpUrl: string; restUrl: string }) {
  const [state, formAction, pending] = useActionState<CreateTokenResult | null, FormData>(
    createToken,
    null,
  );
  const [copied, setCopied] = useState(false);
  const [activeToken, setActiveToken] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok && state.plaintext) setActiveToken(state.plaintext);
  }, [state]);

  async function copyToken() {
    if (!state?.plaintext) return;
    await navigator.clipboard.writeText(state.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-h3">Create a token</h2>
        <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1">
            <span className="text-caption uppercase text-text-subtle">Token name</span>
            <input
              name="name"
              type="text"
              required
              maxLength={64}
              placeholder='e.g. "Maria&apos;s Cursor"'
              className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-body-sm outline-none placeholder:text-text-subtle focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Generating…' : 'Generate token'}
          </button>
        </form>

        {state?.error && <p className="text-body-sm text-error">{state.error}</p>}

        {state?.ok && state.plaintext && (
          <div className="space-y-3 rounded-md border border-accent bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-caption uppercase text-text-subtle">
                Save this now — it won&apos;t be shown again
              </p>
              <button
                type="button"
                onClick={copyToken}
                className="rounded-md border border-border px-3 py-1 text-body-sm font-medium hover:border-border-strong"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-sm bg-[var(--code-bg)] px-3 py-2 font-mono text-mono">
              <code>{state.plaintext}</code>
            </pre>
            <p className="text-body-sm text-text-muted">
              Token <span className="font-mono">{state.name}</span> created. The plaintext
              disappears once you navigate away — it&apos;s already substituted into the
              snippets below.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-h3">Drop into your agent</h2>
        <ConfigBlocks mcpUrl={mcpUrl} restUrl={restUrl} token={activeToken} />
      </section>
    </div>
  );
}
