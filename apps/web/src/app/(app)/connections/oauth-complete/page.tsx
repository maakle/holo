'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Tiny landing page used as the OAuth redirect target. When opened in a popup
 * (the normal case via connector-row.connect()), it posts a message to the
 * opener tab and closes itself. The opener tab handles the result without
 * ever reloading — so wizard state, scroll position, etc. are preserved.
 *
 * If the user landed here directly (popup blocked, opened in a fresh tab,
 * etc.), we fall back to redirecting to /connections with appropriate query
 * params. The connections page treats `?onboard_slack=1` as a wizard trigger.
 */
export default function OAuthCompletePage() {
  const router = useRouter();
  const sp = useSearchParams();

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
      return;
    }

    // Fallback path: not in a popup (popup blocker triggered same-tab
    // navigation, or user opened the link directly). Send to /connections.
    // For Slack, the soft-heuristic in SlackOnboardingTrigger auto-opens the
    // wizard when allowlist is empty; for errors we forward via query params
    // so the connect-error banner can render.
    const url = new URL('/connections', window.location.origin);
    if (status === 'error') {
      if (code) url.searchParams.set('connect_error', code);
      if (fix) url.searchParams.set('connect_fix', fix);
    }
    router.replace(url.pathname + url.search);
  }, [router, sp]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-text-muted">
      Finishing up…
    </div>
  );
}
