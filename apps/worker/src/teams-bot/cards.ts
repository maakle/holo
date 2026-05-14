import type { AdaptiveCardV14, TeamsOutboundActivity } from '@holo/connectors';
import type { Source } from '../slack-bot/agent.js';

/**
 * Adaptive Card v1.4 builders for the Teams bot. Mirror
 * `slack-bot/blocks.ts` and `google-chat-bot/cards.ts`: keep the surface
 * narrow (TextBlocks + a single ActionSet of source URLs) so the reply
 * renders identically across desktop, web, and mobile Teams clients —
 * and Outlook actionable-message digests where Adaptive Cards are
 * downgraded to plain text.
 *
 * We pin the schema at v1.4 deliberately. Older Teams desktop builds
 * (still common in regulated industries) plateau there; v1.5 features
 * (e.g. compound buttons, themed colors) layer on later behind the
 * same export shape.
 *
 * The `text` field on the outbound Activity is always populated as a
 * fallback — Teams uses it for notification toasts and email digest
 * snippets where cards aren't rendered.
 *
 * TODO(reactions): when Teams user mapping ships (parallel to
 * `slack_user_credentials`), append a "React 👍/👎 to rate this answer"
 * line to `answerCard` — mirroring the Slack bot's FEEDBACK_PROMPT.
 * Reactions already arrive on the same /api/messages endpoint, but we
 * can't attribute the feedback row without a holo-user mapping yet.
 */

const ERROR_MESSAGE =
  'Something went wrong answering that — try again, or rephrase.';
const PLACEHOLDER_MESSAGE = 'holo is thinking…';

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
export const PLACEHOLDER_TEXT = PLACEHOLDER_MESSAGE;

function adaptiveCardEnvelope(card: AdaptiveCardV14): TeamsOutboundActivity['attachments'] {
  return [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }];
}

export function placeholderActivity(): TeamsOutboundActivity {
  const card: AdaptiveCardV14 = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [{ type: 'TextBlock', text: PLACEHOLDER_MESSAGE, wrap: true, isSubtle: true }],
  };
  return {
    type: 'message',
    text: PLACEHOLDER_MESSAGE,
    attachments: adaptiveCardEnvelope(card),
  };
}

export function progressActivity(text: string): TeamsOutboundActivity {
  const card: AdaptiveCardV14 = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [{ type: 'TextBlock', text, wrap: true, isSubtle: true }],
  };
  return { type: 'message', text, attachments: adaptiveCardEnvelope(card) };
}

export function answerActivity(
  answer: string,
  sources: Source[],
): TeamsOutboundActivity {
  const body: AdaptiveCardV14['body'] = [
    { type: 'TextBlock', text: answer, wrap: true },
  ];
  const actions: AdaptiveCardV14['actions'] = [];

  if (sources.length > 0) {
    body.push({
      type: 'TextBlock',
      text: 'Sources',
      weight: 'bolder',
      spacing: 'medium',
      separator: true,
    });
    sources.forEach((s, i) => {
      // Position N-1 corresponds to the `[N]` reference the model emits
      // in the answer text — prefix so the cross-reference is visible.
      // Match slack-bot/blocks.ts + google-chat-bot/cards.ts exactly.
      body.push({
        type: 'TextBlock',
        text: `[${i + 1}] ${s.provider} · ${s.kind} · ${s.title}`,
        wrap: true,
        isSubtle: true,
        size: 'small',
      });
      // Adaptive Cards renders Action.OpenUrl as a button row at the
      // card bottom; only attach when we have a usable URL (Salesforce,
      // HubSpot, … may ship label-only sources today).
      if (s.url !== undefined) {
        actions.push({
          type: 'Action.OpenUrl',
          title: `[${i + 1}] ${s.title}`,
          url: s.url,
        });
      }
    });
  }

  const card: AdaptiveCardV14 = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    ...(actions.length > 0 ? { actions } : {}),
  };
  return {
    type: 'message',
    text: answer || 'holo answered your question.',
    attachments: adaptiveCardEnvelope(card),
  };
}

export function errorActivity(): TeamsOutboundActivity {
  const card: AdaptiveCardV14 = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [{ type: 'TextBlock', text: ERROR_MESSAGE, wrap: true }],
  };
  return {
    type: 'message',
    text: ERROR_MESSAGE,
    attachments: adaptiveCardEnvelope(card),
  };
}
