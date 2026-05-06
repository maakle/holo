import type { SlackBlock } from '@holo/connectors';
import type { Source } from './agent.js';

const ERROR_MESSAGE =
  'Something went wrong answering that — try again, or rephrase.';

export function buildAgentAnswerBlocks(
  answer: string,
  sources: Source[],
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
  ];
  if (sources.length === 0) return blocks;

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
  return blocks;
}

export function buildErrorBlocks(): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ERROR_MESSAGE } },
  ];
}

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
