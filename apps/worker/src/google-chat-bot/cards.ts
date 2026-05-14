import { randomUUID } from 'node:crypto';
import type { GoogleChatCardV2Message } from '@holo/connectors';
import type { Source } from '../slack-bot/agent.js';

/**
 * Cards v2 message builders for the Chat App. Mirror `slack-bot/blocks.ts`
 * in role — keep the surface narrow (no buttons, no chips, no images) so
 * the bot's reply renders identically across web, mobile, and inline
 * notifications. Future iterations can swap richer widgets behind the
 * same export shape.
 *
 * The `text` field is always populated as a fallback — Chat uses it for
 * push-notification previews and email digest snippets where cards aren't
 * rendered.
 *
 * TODO(reactions): once the Workspace Events reaction subscription lands
 * (post-launch step 11 in docs/designs/google-chat-app.md), append a
 * "React 👍/👎 to rate this answer" prompt to `answerCard` — mirroring
 * the slack-bot/blocks.ts FEEDBACK_PROMPT block that nudges users into
 * RFC-0008. Not adding it now: reactions don't yet produce feedback
 * rows on Chat, so the prompt would be a UX promise we can't keep.
 */

const ERROR_MESSAGE =
  'Something went wrong answering that — try again, or rephrase.';
const PLACEHOLDER_MESSAGE = 'holo is thinking…';

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
export const PLACEHOLDER_TEXT = PLACEHOLDER_MESSAGE;

export function placeholderCard(): GoogleChatCardV2Message {
  return {
    text: PLACEHOLDER_MESSAGE,
    cardsV2: [
      {
        cardId: randomUUID(),
        card: {
          sections: [
            {
              widgets: [{ textParagraph: { text: `_${PLACEHOLDER_MESSAGE}_` } }],
            },
          ],
        },
      },
    ],
  };
}

export function answerCard(
  answer: string,
  sources: Source[],
): GoogleChatCardV2Message {
  const sections = [
    {
      widgets: [{ textParagraph: { text: answer } }],
    },
  ];
  if (sources.length > 0) {
    sections.push({
      header: 'Sources',
      widgets: sources.map((s, i) => {
        // Position N-1 corresponds to the `[N]` reference the model emits
        // in the answer text — prefix so the cross-reference is visible.
        const linked =
          s.url !== undefined
            ? `<a href="${escapeHref(s.url)}">${escapeText(s.title)}</a>`
            : escapeText(s.title);
        return {
          textParagraph: {
            text: `[${i + 1}] ${escapeText(s.provider)} · ${escapeText(s.kind)} · ${linked}`,
          },
        };
      }),
    } as (typeof sections)[number]);
  }
  return {
    text: answer || 'holo answered your question.',
    cardsV2: [
      {
        cardId: randomUUID(),
        card: { sections },
      },
    ],
  };
}

export function errorCard(): GoogleChatCardV2Message {
  return {
    text: ERROR_MESSAGE,
    cardsV2: [
      {
        cardId: randomUUID(),
        card: {
          sections: [{ widgets: [{ textParagraph: { text: ERROR_MESSAGE } }] }],
        },
      },
    ],
  };
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHref(s: string): string {
  // Chat Cards v2 accepts http/https URLs only; refuse anything else by
  // falling back to about:blank so a malicious source can't smuggle a
  // javascript: URL through the chat client.
  if (!/^https?:\/\//i.test(s)) return 'about:blank';
  return s.replace(/"/g, '%22');
}
