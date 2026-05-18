import { randomUUID } from 'node:crypto';
import type {
  GoogleChatCardSection,
  GoogleChatCardV2Message,
} from '@holo/connectors';
import type { Source } from '../slack-bot/agent.js';

/**
 * Cards v2 message builders for the Chat App. Mirror `slack-bot/blocks.ts`
 * in role — keep the surface narrow (no buttons, no chips, no images) so
 * the bot's reply renders identically across web, mobile, and inline
 * notifications. Future iterations can swap richer widgets behind the
 * same export shape.
 *
 * We intentionally omit the top-level `text` field: Google Chat renders a
 * message with both `text` and `cardsV2` as two stacked bubbles (text on
 * top, card below), which doubles up every reply. Notification previews
 * fall back to the card's first textParagraph, which is good enough.
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

// Google Workspace Marketplace review requires an unsolicited welcome
// message on ADDED_TO_SPACE / DM-start, distinct from the /help reply.
// The two share no copy on purpose: the reviewer checks that both surfaces
// exist and serve different intents (orientation vs. usage examples).
const WELCOME_HEADLINE = `👋 Hi! I'm <b>Holo</b> — your team's knowledge agent in Google Chat.`;
const WELCOME_BODY =
  `I bring together what your team already knows — across Slack, Notion, Drive, GitHub, Linear and more — so you can find answers without leaving Chat.<br><br>` +
  `<b>Try me:</b> @mention me in this space with a question, or send me a DM.<br><br>` +
  `Type <b>/help</b> any time for examples and tips.`;

const HELP_HEADLINE = `Here's how to use Holo:`;
const HELP_BODY =
  `<b>In a space:</b> @mention me with a question. Examples:<br>` +
  `&nbsp;&nbsp;• @Holo what's our refund policy?<br>` +
  `&nbsp;&nbsp;• @Holo find the latest design doc for billing<br>` +
  `&nbsp;&nbsp;• @Holo summarize recent customer feedback<br><br>` +
  `<b>In a DM:</b> just ask — no @mention needed.<br><br>` +
  `Answers are grounded in your team's connected tools and respect each user's existing access. ` +
  `Manage connections at <a href="https://holobase.dev">holobase.dev</a>.`;

export function placeholderCard(): GoogleChatCardV2Message {
  return {
    cardsV2: [
      {
        cardId: randomUUID(),
        card: {
          sections: [
            {
              widgets: [{ textParagraph: { text: `<i>${PLACEHOLDER_MESSAGE}</i>` } }],
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
  const sections: GoogleChatCardSection[] = [
    {
      widgets: [{ textParagraph: { text: slackMrkdwnToCardsHtml(answer) } }],
    },
  ];
  if (sources.length > 0) {
    sections.push({
      header: 'Sources',
      // Collapse the source list by default — Cards v2 renders an automatic
      // "Show more" toggle. Mirrors the Slack bot's button-driven reveal so
      // a 15-source answer doesn't visually swamp the actual reply.
      collapsible: true,
      uncollapsibleWidgetsCount: 0,
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
    });
  }
  return {
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

export function welcomeCard(): GoogleChatCardV2Message {
  return {
    cardsV2: [
      {
        cardId: randomUUID(),
        card: {
          sections: [
            {
              widgets: [
                { textParagraph: { text: WELCOME_HEADLINE } },
                { textParagraph: { text: WELCOME_BODY } },
              ],
            },
          ],
        },
      },
    ],
  };
}

export function helpCard(): GoogleChatCardV2Message {
  return {
    cardsV2: [
      {
        cardId: randomUUID(),
        card: {
          sections: [
            {
              widgets: [
                { textParagraph: { text: HELP_HEADLINE } },
                { textParagraph: { text: HELP_BODY } },
              ],
            },
          ],
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

/**
 * Convert the agent's Slack-mrkdwn answer text to the subset of HTML that
 * Cards v2 `textParagraph` understands (`<b>`, `<i>`, `<a href>`, `<br>`).
 *
 * The agent was trained against Slack rendering and emits `*bold*`,
 * `_italic_`, and `<url|label>` link syntax. Passing that string straight
 * into a textParagraph renders the asterisks/underscores literally, which
 * is what we saw before this conversion existed.
 *
 * Strategy: pull out `<url|label>` link tokens first (they contain literal
 * `<>` that would otherwise be HTML-escaped), escape the remaining text,
 * apply markdown substitutions, then re-insert link tokens as `<a>` tags.
 * Order matters: link extraction has to precede HTML escaping, and
 * markdown substitution has to follow it so the regexes don't match
 * inside escaped entities. The sentinel is a 3-char ASCII tag (`@@N@`)
 * chosen to be vanishingly rare in answer text and to contain no
 * markdown-significant characters.
 */
export function slackMrkdwnToCardsHtml(input: string): string {
  const linkTokens: string[] = [];
  let staged = input.replace(
    /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g,
    (_, url: string, label?: string) => {
      const i = linkTokens.length;
      const href = escapeHref(url.trim());
      const text = escapeText((label ?? url).trim());
      linkTokens.push(`<a href="${href}">${text}</a>`);
      return `@@${i}@`;
    },
  );

  staged = escapeText(staged);

  staged = staged
    // Bold: `**text**` (CommonMark) first so it isn't half-consumed by the
    // single-asterisk Slack form below.
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<b>$2</b>')
    // Italic: `_text_` — avoid matching `snake_case_words` by requiring a
    // non-word boundary on both sides.
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>')
    // Strikethrough: `~text~`.
    .replace(/(^|[^\w~])~([^~\n]+)~(?!\w)/g, '$1<s>$2</s>');

  staged = staged.replace(/@@(\d+)@/g, (_, idx: string) => {
    return linkTokens[Number(idx)] ?? '';
  });

  return staged;
}
