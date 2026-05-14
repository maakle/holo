import { describe, it, expect } from 'vitest';
import {
  buildAgentAnswerBlocks,
  buildAgentAnswerBlocksInline,
  buildAnswerMetadata,
  buildErrorBlocks,
  buildSourcesBlocks,
  HOLO_ANSWER_METADATA_EVENT_TYPE,
  SHOW_SOURCES_ACTION_ID,
} from '../src/slack-bot/blocks';
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
  it('renders prose, a Show sources button, and the feedback footer when sources exist', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const blocks = buildAgentAnswerBlocks('Deploys via *Vercel* [1][2].', sources);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Deploys via *Vercel* [1][2].' },
    });
    expect(blocks[1]).toEqual({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: SHOW_SOURCES_ACTION_ID,
          text: { type: 'plain_text', text: '📎 Show sources (2)', emoji: true },
          value: 'show_sources',
        },
      ],
    });
    expect(blocks[2]).toEqual(FEEDBACK_FOOTER);
  });

  it('omits the button when sources is empty but still appends the feedback footer', () => {
    const blocks = buildAgentAnswerBlocks('No sources used.', []);
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'No sources used.' } },
      FEEDBACK_FOOTER,
    ]);
  });
});

describe('buildAnswerMetadata', () => {
  it('wraps the source list in the holo_answer event envelope', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
    ];
    expect(buildAnswerMetadata(sources)).toEqual({
      event_type: HOLO_ANSWER_METADATA_EVENT_TYPE,
      event_payload: { sources },
    });
  });
});

describe('buildSourcesBlocks', () => {
  it('renders a Sources header followed by [N]-prefixed rows with links when present', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'salesforce', kind: 'account', title: 'Salesforce account — Acme' },
    ];
    const blocks = buildSourcesBlocks(sources);
    expect(blocks[0]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    expect(blocks[1]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[1] github · doc · <https://github.com/a/b|README>' },
      ],
    });
    expect(blocks[2]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[2] salesforce · account · Salesforce account — Acme' },
      ],
    });
  });
});

describe('buildAgentAnswerBlocksInline (slash-command path)', () => {
  it('renders prose, divider, Sources header, [N]-prefixed rows, and the feedback footer', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
    ];
    const blocks = buildAgentAnswerBlocksInline('Deploys via *Vercel* [1].', sources);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Deploys via *Vercel* [1].' },
    });
    expect(blocks[1]).toEqual({ type: 'divider' });
    expect(blocks[2]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    expect(blocks[3]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '[1] github · doc · <https://github.com/a/b|README>' },
      ],
    });
    expect(blocks[4]).toEqual(FEEDBACK_FOOTER);
  });

  it('omits the divider and sources header when sources is empty but still appends the feedback footer', () => {
    const blocks = buildAgentAnswerBlocksInline('No sources used.', []);
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
