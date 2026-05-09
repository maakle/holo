import { type SlackApiClient } from '@holo/connectors';
import { PLACEHOLDER_TEXT } from './agent-events.js';

/**
 * Throttled chat.update wrapper. Slack's `chat.update` is Tier 3 and
 * rate-limits aggressively per-channel — we coalesce updates to one every
 * 750ms. The latest pending text always wins; transient intermediate states
 * may be skipped (fine — they're ephemeral). `flush` is a no-op here; the
 * caller does a final chat.update with the actual answer/error blocks.
 */
export function makePlaceholderProgress(args: {
  client: SlackApiClient;
  channel: string;
  ts: string;
}): { update: (text: string) => void } {
  const intervalMs = 750;
  let lastSentAt = 0;
  let pendingText: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastSentText = PLACEHOLDER_TEXT;

  const send = async (text: string): Promise<void> => {
    if (text === lastSentText) return;
    lastSentText = text;
    lastSentAt = Date.now();
    try {
      await args.client.chatUpdate({
        channel: args.channel,
        ts: args.ts,
        text,
      });
    } catch {
      // Progress is best-effort; don't fail the agent if a chat.update slips.
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
