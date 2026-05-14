import { describe, it, expect } from 'vitest';
import { buildAgentAnswerBlocks, buildErrorBlocks } from '../src/slack-bot/blocks';
import type { Source } from '../src/slack-bot/agent';

const FEEDBACK_FOOTER = {
  type: 'context',
  elements: [
    {
      type: 'mrkdwn',
      text: 'React with :+1: or :-1: to rate this answer and help improve future responses.',
    },
  ],
};

describe('buildAgentAnswerBlocks', () => {
  it('renders prose, divider, sources header, one context per source, and a feedback footer', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const blocks = buildAgentAnswerBlocks('Deploys via *Vercel*.', sources);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Deploys via *Vercel*.' },
    });
    expect(blocks[1]).toEqual({ type: 'divider' });
    expect(blocks[2]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    expect(blocks[3]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'github · doc · <https://github.com/a/b|README>' },
      ],
    });
    expect(blocks[4]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'notion · doc · <https://www.notion.so/x|Runbook>' },
      ],
    });
    expect(blocks[5]).toEqual(FEEDBACK_FOOTER);
  });

  it('omits the divider and sources header when sources is empty but still appends the feedback footer', () => {
    const blocks = buildAgentAnswerBlocks('No sources used.', []);
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'No sources used.' } },
      FEEDBACK_FOOTER,
    ]);
  });
});

describe('buildErrorBlocks', () => {
  it('renders a single section with the standard error message', () => {
    const blocks = buildErrorBlocks();
    expect(blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Something went wrong answering that — try again, or rephrase.',
        },
      },
    ]);
  });
});
