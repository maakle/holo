'use client';
import { useEffect, useState } from 'react';
import { SlackOnboardingDialog } from '@/components/slack-onboarding-dialog';

interface Props {
  slackConnected: boolean;
  slackAllowlistEmpty: boolean;
  connectedAs?: string;
}

const DISMISS_STORAGE_KEY = 'holo:slack-onboarding-dismissed-v1';
const START_EVENT = 'holo:slack-onboarding-start';

/**
 * Auto-opens the Slack onboarding wizard. Two triggers:
 *
 * 1) `holo:slack-onboarding-start` window event — fired by connector-row
 *    when the user clicks Connect on the Slack row. Opens the wizard at
 *    step 1 (Install), which owns the OAuth popup.
 *
 * 2) Soft heuristic on mount: Slack is already connected, allowlist is empty,
 *    and the user hasn't dismissed the wizard in this browser. Probes
 *    sync-status to confirm 0 chunks indexed before opening (no point
 *    nagging if work is already happening). Skips step 1.
 *
 * Open state is purely local — OAuth runs in a popup, so this tab never
 * navigates and nothing can perturb the wizard mid-flow.
 */
export function SlackOnboardingTrigger({
  slackConnected,
  slackAllowlistEmpty,
  connectedAs,
}: Props) {
  const [open, setOpen] = useState(false);

  // Trigger 1: user clicked Connect.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(START_EVENT, handler);
    return () => window.removeEventListener(START_EVENT, handler);
  }, []);

  // Trigger 2: soft heuristic — already-connected user with empty allowlist.
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
          setOpen(true);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slackConnected, slackAllowlistEmpty]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    }
  }

  if (!open) return null;
  return (
    <SlackOnboardingDialog
      open={open}
      onOpenChange={handleOpenChange}
      slackConnected={slackConnected}
      connectedAs={connectedAs}
    />
  );
}
