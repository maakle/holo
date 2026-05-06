'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Tiny landing page used as the OAuth redirect target. When opened in a popup
 * (the normal case via connector-row.connect()), it posts a message to the
 * opener tab and closes itself. The opener tab handles the result without
 * ever reloading — so wizard state, scroll position, etc. are preserved.
 *
 * If the user landed here directly (popup blocked, opened in a fresh tab,
 * etc.), we fall back to redirecting to /connections with appropriate query
 * params.
 */
export default function OAuthCompletePage() {
  const router = useRouter();
  const sp = useSearchParams();
  // Stays false in the close-the-popup path. Flips true if window.close()
  // didn't fire (Safari, multi-step OAuth history) so the user gets an
  // explicit close button rather than an opaque "Finishing up…" screen.
  const [showManualClose, setShowManualClose] = useState(false);

  useEffect(() => {
    const provider = sp.get('provider') ?? '';
    const status = sp.get('status') ?? 'error';
    const code = sp.get('code') ?? undefined;
    const fix = sp.get('fix') ?? undefined;

    const message = { type: 'holo:oauth-complete', provider, status, code, fix } as const;

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(message, window.location.origin);
      } catch {
        // best-effort; opener may be cross-origin or gone
      }
      window.close();
      // If close didn't fire within ~300ms (Safari, popups with multi-step
      // history), surface a manual close button instead of navigating away —
      // navigating would replace this popup with /connections, which the user
      // perceives as the wizard dialog disappearing.
      const timer = window.setTimeout(() => setShowManualClose(true), 300);
      return () => window.clearTimeout(timer);
    }

    // Fallback path: not in a popup (popup blocker triggered same-tab
    // navigation, or user opened the link directly). Send to /connections.
    const url = new URL('/connections', window.location.origin);
    if (status === 'error') {
      if (code) url.searchParams.set('connect_error', code);
      if (fix) url.searchParams.set('connect_fix', fix);
    }
    router.replace(url.pathname + url.search);
  }, [router, sp]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-[13px] text-text-muted">
      {showManualClose ? (
        <>
          <p>Done — your wizard is in the original tab.</p>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-text hover:bg-surface-2"
          >
            Close this window
          </button>
        </>
      ) : (
        <p>Finishing up…</p>
      )}
    </div>
  );
}
