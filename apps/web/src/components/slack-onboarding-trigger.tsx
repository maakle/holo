'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SlackOnboardingDialog } from '@/components/slack-onboarding-dialog';

interface Props {
  slackConnected: boolean;
  slackAllowlistEmpty: boolean;
  connectedAs?: string;
}

const DISMISS_STORAGE_KEY = 'holo:slack-onboarding-dismissed-v1';

/**
 * Soft auto-open for the Slack onboarding wizard. Triggers on:
 * 1) `?onboard_slack=1` query param (set by the OAuth callback) — always opens.
 * 2) Soft heuristic: Slack is connected, allowlist is empty, and the user
 *    hasn't dismissed the wizard in this browser. Probes /sync-status to
 *    confirm 0 chunks indexed before opening (no point nagging if work is
 *    already happening).
 *
 * Dismissal persists in localStorage so power-users who closed the wizard
 * intentionally don't see it on every page load. Per-browser only — fine
 * for now, can move to user prefs later.
 */
export function SlackOnboardingTrigger({
  slackConnected,
  slackAllowlistEmpty,
  connectedAs,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!slackConnected) return;

    // Trigger 1: explicit query param wins, regardless of dismissal state.
    if (searchParams.get('onboard_slack') === '1') {
      setOpen(true);
      // Strip the param so a refresh doesn't re-pop the dialog.
      const url = new URL(window.location.href);
      url.searchParams.delete('onboard_slack');
      router.replace(url.pathname + url.search, { scroll: false });
      return;
    }

    // Trigger 2: soft heuristic.
    if (!slackAllowlistEmpty) return;
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem(DISMISS_STORAGE_KEY) === '1';
    if (dismissed) return;

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
        // best-effort; don't pop the dialog if the probe failed
      }
    })();
    return () => {
      cancelled = true;
    };
    // searchParams reference changes on navigation; intentional re-evaluate.
  }, [slackConnected, slackAllowlistEmpty, searchParams, router]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && typeof window !== 'undefined') {
      // Remember the user closed it — don't re-pop on the soft heuristic.
      // The query-param trigger ignores this, so a fresh OAuth still opens
      // the wizard.
      window.localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    }
  }

  if (!slackConnected) return null;
  return (
    <SlackOnboardingDialog
      open={open}
      onOpenChange={handleOpenChange}
      connectedAs={connectedAs}
    />
  );
}
