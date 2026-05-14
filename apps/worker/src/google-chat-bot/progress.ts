import type { GoogleChatAppApiClient } from '@holo/connectors';
import { placeholderCard } from './cards.js';
import { randomUUID } from 'node:crypto';

/**
 * Throttled `messages.patch` wrapper for progress text updates. Google
 * Chat doesn't publish per-method quotas the way Slack's tier system
 * does, but patching the same message dozens of times per second is
 * wasteful — coalesce to one patch every 750ms (same cadence as the
 * Slack bot's chat.update throttling).
 *
 * The latest pending text always wins; transient intermediate phases may
 * be skipped (fine — they're ephemeral). The caller does a final patch
 * with the actual answer/error card, which is unthrottled.
 */
export function makeChatPlaceholderProgress(args: {
  client: GoogleChatAppApiClient;
  messageName: string;
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
      // Build a minimal placeholder-shape card with the new text. We share
      // `placeholderCard` for the empty case and substitute its single
      // text widget; this keeps the renderer consistent across phases.
      const base = placeholderCard();
      const body = {
        ...base,
        text,
        cardsV2: [
          {
            cardId: randomUUID(),
            card: {
              sections: [{ widgets: [{ textParagraph: { text: `_${text}_` } }] }],
            },
          },
        ],
      };
      await args.client.patchMessage({ name: args.messageName, body });
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
