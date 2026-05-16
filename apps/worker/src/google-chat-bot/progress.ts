import type { GoogleChatAppApiClient } from '@holo/connectors';
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
 *
 * `cancel()` MUST be awaited by the caller before issuing the final
 * answer patch. Otherwise a pending throttle-timer or in-flight progress
 * patch can land *after* the answer and overwrite it — we observed this
 * in production as "the answer flashed then disappeared back to
 * 'reasoning…'". Cancel disarms the timer, drops pending text, and
 * waits for any send already over the wire to finish (so finalize is
 * strictly the last patch Chat sees).
 */
export function makeChatPlaceholderProgress(args: {
  client: GoogleChatAppApiClient;
  messageName: string;
}): { update: (text: string) => void; cancel: () => Promise<void> } {
  const intervalMs = 750;
  let lastSentAt = 0;
  let pendingText: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastSentText = '';
  let inflight: Promise<void> | null = null;
  let canceled = false;

  const send = async (text: string): Promise<void> => {
    if (canceled) return;
    if (text === lastSentText) return;
    lastSentText = text;
    lastSentAt = Date.now();
    try {
      // Cards-only patch (no top-level `text`): Google Chat renders a
      // message with both fields as two stacked bubbles. Convert the
      // agent's Slack-style `_..._` italic wrapper to Cards v2's HTML
      // `<i>...</i>` so the italic actually renders inside textParagraph.
      const widgetText = text.replace(/^_(.*)_$/s, '<i>$1</i>');
      const body = {
        cardsV2: [
          {
            cardId: randomUUID(),
            card: {
              sections: [{ widgets: [{ textParagraph: { text: widgetText } }] }],
            },
          },
        ],
      };
      await args.client.patchMessage({ name: args.messageName, body });
    } catch {
      // Progress is best-effort; never fail the agent for a missed patch.
    }
  };

  const scheduleSend = (text: string): void => {
    inflight = send(text).finally(() => {
      inflight = null;
    });
  };

  return {
    update: (text: string) => {
      if (canceled) return;
      pendingText = text;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= intervalMs) {
        const t = pendingText;
        pendingText = null;
        scheduleSend(t);
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (pendingText !== null && !canceled) {
          const t = pendingText;
          pendingText = null;
          scheduleSend(t);
        }
      }, intervalMs - elapsed);
    },
    cancel: async () => {
      canceled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingText = null;
      if (inflight) {
        try {
          await inflight;
        } catch {
          // send() already swallows errors; this catch is defensive.
        }
      }
    },
  };
}
