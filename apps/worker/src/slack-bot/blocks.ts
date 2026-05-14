import type { SlackBlock, SlackMessageMetadata } from '@holo/connectors';
import type { Source } from './agent.js';

const ERROR_MESSAGE =
  'Something went wrong answering that — try again, or rephrase.';

const FEEDBACK_PROMPT =
  'React with :+1: or :-1: to rate this answer and help improve future responses.';

/**
 * action_id Slack sends back when the user clicks "Show sources". The gateway
 * interactivity handler routes on this constant — keep in sync.
 */
export const SHOW_SOURCES_ACTION_ID = 'holo_show_sources';

/**
 * event_type we stamp on the answer message's metadata. Slack round-trips the
 * full metadata envelope in `block_actions` payloads, so the interactivity
 * handler can read the source list back without a DB round-trip.
 */
export const HOLO_ANSWER_METADATA_EVENT_TYPE = 'holo_answer';

/**
 * Build the metadata envelope to attach to a finalized answer message. Slack
 * limits `event_payload` to 8000 chars total — practically not a concern for
 * our source lists (≤10 sources × ~150 chars), so no truncation here.
 */
export function buildAnswerMetadata(sources: Source[]): SlackMessageMetadata {
  return {
    event_type: HOLO_ANSWER_METADATA_EVENT_TYPE,
    event_payload: { sources },
  };
}

/**
 * Public answer message — collapses the source list behind a "Show sources"
 * button to keep the channel reply tight. The button is rendered only when
 * sources exist; the full list lives in the message's `metadata` (attached
 * separately at post time) so the interactivity handler can echo it back
 * ephemerally with no DB lookup.
 */
export function buildAgentAnswerBlocks(
  answer: string,
  sources: Source[],
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
  ];

  if (sources.length > 0) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: SHOW_SOURCES_ACTION_ID,
          text: {
            type: 'plain_text',
            text: `📎 Show sources (${sources.length})`,
            emoji: true,
          },
          // Slack requires a value on action buttons; we read sources from
          // message.metadata in the handler, so the value is just a marker.
          value: 'show_sources',
        },
      ],
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: FEEDBACK_PROMPT }],
  });
  return blocks;
}

/**
 * Inline variant — renders the full source list directly in the message.
 * Used by the slash command path (`/holo …`), which posts via response_url:
 * ephemeral response_url messages don't preserve `metadata`, so the button +
 * metadata-roundtrip mechanism doesn't work for them. Channel mentions and
 * DMs use the collapsed button variant via `buildAgentAnswerBlocks`.
 */
export function buildAgentAnswerBlocksInline(
  answer: string,
  sources: Source[],
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
  ];
  if (sources.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push(...buildSourcesBlocks(sources));
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: FEEDBACK_PROMPT }],
  });
  return blocks;
}

/**
 * Ephemeral "Sources" reveal — posted via the action's response_url when the
 * user clicks the button on an answer message. Identical row format to the
 * old inline list so the cross-reference with `[N]` markers in the answer
 * text still reads naturally.
 */
export function buildSourcesBlocks(sources: Source[]): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    },
  ];
  sources.forEach((s, i) => {
    const linked = s.url ? `<${s.url}|${s.title}>` : s.title;
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `[${i + 1}] ${s.provider} · ${s.kind} · ${linked}`,
        },
      ],
    });
  });
  return blocks;
}

export function buildErrorBlocks(): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ERROR_MESSAGE } },
  ];
}

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
