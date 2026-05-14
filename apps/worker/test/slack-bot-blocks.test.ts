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
  it('renders prose, divider, sources header, [N]-prefixed source rows, and feedback footer', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const blocks = buildAgentAnswerBlocks('Deploys via *Vercel* [1][2].', sources);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Deploys via *Vercel* [1][2].' },
    });
    expect(blocks[1]).toEqual({ type: 'divider' });
    expect(blocks[2]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    // Position N-1 maps to `[N]` reference; row prefix makes the
    // cross-reference visible.
    expect(blocks[3]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[1] github · doc · <https://github.com/a/b|README>' },
      ],
    });
    expect(blocks[4]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[2] notion · doc · <https://www.notion.so/x|Runbook>' },
      ],
    });
    expect(blocks[5]).toEqual(FEEDBACK_FOOTER);
  });

  it('renders sources without a url as label-only (no Slack link wrapper)', () => {
    const sources: Source[] = [
      { provider: 'salesforce', kind: 'account', title: 'Salesforce account — Acme' },
    ];
    const blocks = buildAgentAnswerBlocks('Acme is an account [1].', sources);
    expect(blocks[3]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[1] salesforce · account · Salesforce account — Acme' },
      ],
    });
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
