import { describe, it, expect } from 'vitest';
import { answerCard, errorCard, placeholderCard } from '../src/google-chat-bot/cards';
import type { Source } from '../src/slack-bot/agent';

describe('placeholderCard', () => {
  it('returns a Cards v2 message with the thinking text and a single section', () => {
    const card = placeholderCard();
    expect(card.text).toContain('thinking');
    expect(card.cardsV2).toHaveLength(1);
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    expect(sections[0]!.widgets).toHaveLength(1);
  });
});

describe('answerCard', () => {
  it('renders the answer text plus a sources section when sources exist', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const card = answerCard('Deploys via Vercel.', sources);
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(2);
    // First section: the answer body.
    expect(sections[0]!.widgets[0]).toEqual({
      textParagraph: { text: 'Deploys via Vercel.' },
    });
    // Second section: sources header + one widget per source.
    expect(sections[1]!.header).toBe('Sources');
    expect(sections[1]!.widgets).toHaveLength(2);
    const first = sections[1]!.widgets[0] as { textParagraph: { text: string } };
    expect(first.textParagraph.text).toContain('github · doc');
    expect(first.textParagraph.text).toContain('https://github.com/a/b');
    expect(first.textParagraph.text).toContain('README');
  });

  it('omits the sources section when no sources are provided', () => {
    const card = answerCard('No sources used.', []);
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    expect(card.text).toBe('No sources used.');
  });

  it('rejects non-http(s) URLs to prevent javascript: smuggling', () => {
    const sources: Source[] = [
      { provider: 'evil', kind: 'doc', title: 'oops', url: 'javascript:alert(1)' },
    ];
    const card = answerCard('answer', sources);
    const text = (
      card.cardsV2![0]!.card.sections![1]!.widgets[0] as {
        textParagraph: { text: string };
      }
    ).textParagraph.text;
    expect(text).toContain('about:blank');
    expect(text).not.toContain('javascript:');
  });

  it('escapes HTML metacharacters in source titles', () => {
    const sources: Source[] = [
      {
        provider: 'wiki',
        kind: 'doc',
        title: '<script>alert(1)</script>',
        url: 'https://example.com/x',
      },
    ];
    const card = answerCard('answer', sources);
    const text = (
      card.cardsV2![0]!.card.sections![1]!.widgets[0] as {
        textParagraph: { text: string };
      }
    ).textParagraph.text;
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });
});

describe('errorCard', () => {
  it('renders a single section with the standard error message', () => {
    const card = errorCard();
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    const widget = sections[0]!.widgets[0] as { textParagraph: { text: string } };
    expect(widget.textParagraph.text).toContain('Something went wrong');
    expect(card.text).toContain('Something went wrong');
  });
});
