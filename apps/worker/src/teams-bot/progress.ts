import type { TeamsBotApiClient } from '@holo/connectors';
import { progressActivity } from './cards.js';

/**
 * Throttled `updateActivity` wrapper for progress text updates.
 * Microsoft documents ~1800 messages/30s per bot per channel for the
 * Bot Connector API; patching the placeholder dozens of times per
 * second would burn that quota for no benefit. Coalesce to one update
 * every 750ms — same cadence as `slack-bot/progress.ts` and
 * `google-chat-bot/progress.ts`.
 *
 * The latest pending text always wins; intermediate phases may be
 * skipped (fine — they're ephemeral). The caller does an unthrottled
 * final patch with the actual answer/error card.
 */
export function makeTeamsPlaceholderProgress(args: {
  client: TeamsBotApiClient;
  serviceUrl: string;
  conversationId: string;
  activityId: string;
}): { update: (text: string) => void } {
  const intervalMs = 750;
  let lastSentAt = 0;
  let pendingText: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastSentText = '';

  const send = async (text: string): Promise<void> => {
    if (text === lastSentText) return;
    lastSentText = text;
    lastSentAt = Date.now();
    try {
      await args.client.updateActivity({
        serviceUrl: args.serviceUrl,
        conversationId: args.conversationId,
        activityId: args.activityId,
        body: progressActivity(text),
      });
    } catch {
      // Progress is best-effort; never fail the agent for a missed patch.
    }
  };

  return {
    update: (text: string) => {
      pendingText = text;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= intervalMs) {
        const t = pendingText;
        pendingText = null;
        void send(t);
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (pendingText !== null) {
          const t = pendingText;
          pendingText = null;
          void send(t);
        }
      }, intervalMs - elapsed);
    },
  };
}
