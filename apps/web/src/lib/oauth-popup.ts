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

export function openOAuthPopup(
  authorizeUrl: string,
  provider: string,
): Promise<OAuthPopupResult> {
  return new Promise((resolve) => {
    const features = 'popup=yes,width=600,height=750,noopener=no,noreferrer=no';
    const popup = window.open(authorizeUrl, `holo-oauth-${provider}`, features);
    if (!popup) {
      // Popup blocked. Same-tab navigation is the safe fallback — the user
      // loses any in-progress page state, but the OAuth flow still works.
      window.location.href = authorizeUrl;
      // Promise never resolves because the page is navigating away.
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

    // Detect manual popup close (user dismissed without finishing OAuth).
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
