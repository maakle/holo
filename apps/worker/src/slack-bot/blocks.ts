import type { SlackBlock } from '@holo/connectors';
import type { Source } from './agent.js';

const ERROR_MESSAGE =
  'Something went wrong answering that — try again, or rephrase.';

const FEEDBACK_PROMPT =
  'React with :+1: or :-1: to rate this answer and help improve future responses.';

export function buildAgentAnswerBlocks(
  answer: string,
  sources: Source[],
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
  ];

  if (sources.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    for (const s of sources) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${s.provider} · ${s.kind} · <${s.url}|${s.title}>`,
          },
        ],
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: FEEDBACK_PROMPT }],
  });
  return blocks;
}

export function buildErrorBlocks(): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ERROR_MESSAGE } },
  ];
}

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
