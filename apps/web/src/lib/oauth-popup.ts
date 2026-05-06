/**
 * Opens an OAuth flow in a popup window and resolves when the popup completes
 * (via postMessage from /connections/oauth-complete) or is closed by the user.
 *
 * Why a popup: keeping the user's tab put means dialog state, scroll position,
 * and any in-flight wizard survive the OAuth round-trip. The opener tab never
 * navigates; it just receives a message and decides what to do.
 *
 * Fallback: if the popup is blocked, we navigate the current tab to the
 * authorize URL. The provider's callback will land on /oauth-complete which
 * detects no opener and redirects to /connections with the legacy params.
 */
export type OAuthPopupResult =
  | { status: 'ok'; provider: string }
  | { status: 'error'; provider: string; code?: string; fix?: string }
  | { status: 'closed'; provider: string };

/**
 * Open a blank popup synchronously inside the user's click handler. Must run
 * before any `await` — once the gesture is consumed, Chrome blocks `window.open`.
 * Returns null if the popup was blocked anyway (e.g. browser-level block).
 */
export function openBlankOAuthPopup(provider: string): Window | null {
  const features = 'popup=yes,width=600,height=750,noopener=no,noreferrer=no';
  return window.open('about:blank', `holo-oauth-${provider}`, features);
}

export function openOAuthPopup(
  authorizeUrl: string,
  provider: string,
  existingPopup?: Window | null,
): Promise<OAuthPopupResult> {
  return new Promise((resolve) => {
    const features = 'popup=yes,width=600,height=750,noopener=no,noreferrer=no';
    let popup: Window | null = existingPopup ?? null;
    if (popup && !popup.closed) {
      try {
        popup.location.href = authorizeUrl;
      } catch {
        popup = null;
      }
    }
    if (!popup || popup.closed) {
      popup = window.open(authorizeUrl, `holo-oauth-${provider}`, features);
    }
    if (!popup) {
      window.location.href = authorizeUrl;
      return;
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as
        | { type?: string; provider?: string; status?: string; code?: string; fix?: string }
        | undefined;
      if (!data || data.type !== 'holo:oauth-complete') return;
      if (data.provider !== provider) return;
      cleanup();
      if (data.status === 'ok') {
        resolve({ status: 'ok', provider });
      } else {
        resolve({ status: 'error', provider, code: data.code, fix: data.fix });
      }
    };

    const closeTimer = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        resolve({ status: 'closed', provider });
      }
    }, 500);

    function cleanup() {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closeTimer);
    }

    window.addEventListener('message', onMessage);
  });
}
