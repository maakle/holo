'use client';
import { useEffect } from 'react';

interface Props {
  slackConnected: boolean;
  slackAllowlistEmpty: boolean;
  /* connectedAs reserved for future copy; not used here. */
  connectedAs?: string;
}

const DISMISS_STORAGE_KEY = 'holo:slack-onboarding-dismissed-v1';

/**
 * Soft heuristic: when Slack is connected, the allowlist is empty, and the
 * user hasn&apos;t dismissed the wizard in this browser, probe sync-status to
 * confirm 0 chunks indexed and dispatch a wizard-open event so the Slack
 * row pops the wizard at the channel-pick step.
 *
 * Renders nothing — pure side effect. The wizard itself lives in
 * ConnectorRow; this component is just the auto-open nudge.
 */
export function SlackOnboardingTrigger({ slackConnected, slackAllowlistEmpty }: Props) {
  useEffect(() => {
    if (!slackConnected) return;
    if (!slackAllowlistEmpty) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(DISMISS_STORAGE_KEY) === '1') return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/connectors/slack/sync-status', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { chunksIndexed?: number; running?: boolean };
        if (cancelled) return;
        if ((body.chunksIndexed ?? 0) === 0 && !body.running) {
          window.dispatchEvent(
            new CustomEvent('holo:open-wizard:slack', {
              detail: { initialStepId: 'channels' },
            }),
          );
          // Once we've nudged, set the dismiss flag so refreshes don't loop.
          window.localStorage.setItem(DISMISS_STORAGE_KEY, '1');
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slackConnected, slackAllowlistEmpty]);

  return null;
}
