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
    sources.forEach((s, i) => {
      // Position N-1 corresponds to the `[N]` reference the model emits in
      // the answer text — prefix the row so the cross-reference is visible.
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
