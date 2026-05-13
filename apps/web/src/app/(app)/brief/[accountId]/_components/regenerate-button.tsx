'use client';

/**
 * Client-side wrapper around the REST `/v1/accounts/:id/brief/regenerate`
 * endpoint. We could have used a server action — but the REST surface is the
 * portable path (it's what skills, MCP, and external integrations call) so
 * we exercise it here too. On success we router.refresh() the page to pull
 * the fresh server-rendered brief.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BriefContext } from '@holo/agent-tools';

export function RegenerateButton({
  accountId,
  context,
}: {
  accountId: string;
  context: BriefContext;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/brief/${accountId}/regenerate?context=${encodeURIComponent(context)}`,
          { method: 'POST' },
        );
        if (!res.ok) {
          // The page-server handler maps everything to a JSON {error} shape;
          // surface that string directly so users see "no access" vs
          // "connector offline" rather than a generic toast.
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          throw new Error(body.problem ?? 'Regenerate failed');
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Regenerate failed');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-[11px] text-error">{error}</span> : null}
      <button
        type="button"
        onClick={regenerate}
        disabled={pending}
        className={
          pending
            ? 'rounded-md border border-border bg-surface-2 px-3 py-1 text-[13px] leading-5 text-text-subtle'
            : 'rounded-md bg-accent px-3 py-1 text-[13px] font-medium leading-5 text-accent-fg hover:opacity-90'
        }
      >
        {pending ? 'Regenerating…' : 'Regenerate'}
      </button>
    </div>
  );
}
