'use client';

import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Opens the Stripe Customer Portal in a new tab. Only rendered for orgs that
 * have a Stripe customer (i.e. completed checkout at least once).
 */
export function ManageSubscriptionButton() {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        fix?: string;
        problem?: string;
      };
      if (!res.ok || !body.url) {
        toast.error(body.fix ?? body.problem ?? 'Could not open the billing portal.');
        return;
      }
      window.location.href = body.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {busy ? 'Opening…' : 'Manage subscription'}
    </button>
  );
}
