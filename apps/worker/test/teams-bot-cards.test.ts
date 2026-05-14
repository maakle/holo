import { describe, it, expect } from 'vitest';
import {
  answerActivity,
  errorActivity,
  placeholderActivity,
  progressActivity,
} from '../src/teams-bot/cards';
import type { Source } from '../src/slack-bot/agent';
import type { AdaptiveCardV14 } from '@holo/connectors';

function adaptiveCard(activity: ReturnType<typeof answerActivity>): AdaptiveCardV14 {
  return activity.attachments![0]!.content;
}

describe('placeholderActivity', () => {
  it('returns an Adaptive Card v1.4 message with the thinking text', () => {
    const a = placeholderActivity();
    expect(a.type).toBe('message');
    expect(a.text).toContain('thinking');
    const card = adaptiveCard(a);
    expect(card.version).toBe('1.4');
    expect(card.body).toHaveLength(1);
  });
});

describe('progressActivity', () => {
  it('renders the progress text as a subtle TextBlock', () => {
    const a = progressActivity('searching docs');
    expect(a.text).toBe('searching docs');
    const card = adaptiveCard(a);
    expect(card.body[0]).toEqual({
      type: 'TextBlock',
      text: 'searching docs',
      wrap: true,
      isSubtle: true,
    });
  });
});

describe('answerActivity', () => {
  it('renders the answer body with a Sources section prefixed with [N]', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const a = answerActivity('Deploys via Vercel.', sources);
    const card = adaptiveCard(a);
    expect(card.body[0]).toEqual({
      type: 'TextBlock',
      text: 'Deploys via Vercel.',
      wrap: true,
    });
    // Body has: answer, "Sources" header, source-row 1, source-row 2.
    expect(card.body).toHaveLength(4);
    const sourcesHeader = card.body[1] as { type: 'TextBlock'; text: string };
    expect(sourcesHeader.text).toBe('Sources');
    const row1 = card.body[2] as { type: 'TextBlock'; text: string };
    expect(row1.text).toMatch(/^\[1\] /);
    expect(row1.text).toContain('github · doc');
    expect(row1.text).toContain('README');
    const row2 = card.body[3] as { type: 'TextBlock'; text: string };
    expect(row2.text).toMatch(/^\[2\] /);
    // Action.OpenUrl entries — one per source with a URL.
    expect(card.actions).toHaveLength(2);
    expect(card.actions![0]!.title).toMatch(/^\[1\] /);
    expect(card.actions![0]!.url).toBe('https://github.com/a/b');
  });

  it('omits the Sources section and actions when no sources are provided', () => {
    const a = answerActivity('No sources used.', []);
    const card = adaptiveCard(a);
    expect(card.body).toHaveLength(1);
    expect(card.actions).toBeUndefined();
    expect(a.text).toBe('No sources used.');
  });

  it('renders label-only with no Action.OpenUrl when a source has no url', () => {
    const sources: Source[] = [
      { provider: 'salesforce', kind: 'opportunity', title: 'Acme renewal' },
    ];
    const a = answerActivity('See opportunity.', sources);
    const card = adaptiveCard(a);
    const row = card.body[2] as { type: 'TextBlock'; text: string };
    expect(row.text).toMatch(/^\[1\] /);
    expect(row.text).toContain('salesforce · opportunity');
    expect(row.text).toContain('Acme renewal');
    // No Action.OpenUrl button because there's no URL to open.
    expect(card.actions).toBeUndefined();
  });

  it('falls back to a placeholder text when the answer is empty', () => {
    const a = answerActivity('', []);
    expect(a.text).toBe('holo answered your question.');
  });
});

describe('errorActivity', () => {
  it('renders the standard error message in both text and card', () => {
    const a = errorActivity();
    expect(a.text).toContain('Something went wrong');
    const card = adaptiveCard(a);
    const block = card.body[0] as { type: 'TextBlock'; text: string };
    expect(block.text).toContain('Something went wrong');
  });
});
