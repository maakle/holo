import { describe, it, expect } from 'vitest';
import {
  answerCard,
  errorCard,
  placeholderCard,
  slackMrkdwnToCardsHtml,
} from '../src/google-chat-bot/cards';
import type { Source } from '../src/slack-bot/agent';

describe('placeholderCard', () => {
  it('returns a Cards v2 message with the thinking text and a single section', () => {
    const card = placeholderCard();
    // No top-level `text` — Google Chat renders both `text` and `cardsV2`
    // as separate bubbles, so we use cards-only to avoid duplication.
    expect(card.text).toBeUndefined();
    expect(card.cardsV2).toHaveLength(1);
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    expect(sections[0]!.widgets).toHaveLength(1);
    const widget = sections[0]!.widgets[0] as { textParagraph: { text: string } };
    expect(widget.textParagraph.text).toContain('thinking');
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
    // Second section: sources header + one widget per source, each prefixed
    // with the `[N]` reference the model is told to emit in the answer text.
    expect(sections[1]!.header).toBe('Sources');
    // Sources section collapses by default so a long list doesn't dominate
    // the reply (`uncollapsibleWidgetsCount: 0` hides every source until
    // the user clicks "Show more").
    expect(sections[1]!.collapsible).toBe(true);
    expect(sections[1]!.uncollapsibleWidgetsCount).toBe(0);
    expect(sections[1]!.widgets).toHaveLength(2);
    const first = sections[1]!.widgets[0] as { textParagraph: { text: string } };
    expect(first.textParagraph.text).toMatch(/^\[1\] /);
    expect(first.textParagraph.text).toContain('github · doc');
    expect(first.textParagraph.text).toContain('https://github.com/a/b');
    expect(first.textParagraph.text).toContain('README');
    const second = sections[1]!.widgets[1] as { textParagraph: { text: string } };
    expect(second.textParagraph.text).toMatch(/^\[2\] /);
  });

  it('renders label-only when a source has no url (matches Slack behavior)', () => {
    const sources: Source[] = [
      { provider: 'salesforce', kind: 'opportunity', title: 'Acme renewal' },
    ];
    const card = answerCard('See opportunity.', sources);
    const text = (
      card.cardsV2![0]!.card.sections![1]!.widgets[0] as {
        textParagraph: { text: string };
      }
    ).textParagraph.text;
    expect(text).toMatch(/^\[1\] /);
    expect(text).toContain('salesforce · opportunity');
    expect(text).toContain('Acme renewal');
    expect(text).not.toContain('<a href=');
  });

  it('omits the sources section when no sources are provided', () => {
    const card = answerCard('No sources used.', []);
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    expect(card.text).toBeUndefined();
    expect(sections[0]!.widgets[0]).toEqual({
      textParagraph: { text: 'No sources used.' },
    });
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
    expect(card.text).toBeUndefined();
    const sections = card.cardsV2![0]!.card.sections!;
    expect(sections).toHaveLength(1);
    const widget = sections[0]!.widgets[0] as { textParagraph: { text: string } };
    expect(widget.textParagraph.text).toContain('Something went wrong');
  });
});

describe('slackMrkdwnToCardsHtml', () => {
  it('converts Slack-style bold, italic, and strikethrough to HTML', () => {
    expect(slackMrkdwnToCardsHtml('*bold*')).toBe('<b>bold</b>');
    expect(slackMrkdwnToCardsHtml('Hello *world*!')).toBe(
      'Hello <b>world</b>!',
    );
    expect(slackMrkdwnToCardsHtml('_italic_')).toBe('<i>italic</i>');
    expect(slackMrkdwnToCardsHtml('~strike~')).toBe('<s>strike</s>');
  });

  it('also handles CommonMark **bold** the model sometimes emits', () => {
    expect(slackMrkdwnToCardsHtml('**bold**')).toBe('<b>bold</b>');
    expect(slackMrkdwnToCardsHtml('see **MID-252**')).toBe(
      'see <b>MID-252</b>',
    );
  });

  it('does not italicize snake_case identifiers', () => {
    // The italic regex requires a non-word boundary on both sides so
    // underscores inside identifiers stay literal.
    expect(slackMrkdwnToCardsHtml('use snake_case_name here')).toBe(
      'use snake_case_name here',
    );
  });

  it('converts Slack <url|label> link syntax to <a href>', () => {
    expect(
      slackMrkdwnToCardsHtml(
        'See <https://example.com/x|the docs> for more.',
      ),
    ).toBe('See <a href="https://example.com/x">the docs</a> for more.');
  });

  it('converts bare <url> tokens to <a href>', () => {
    expect(slackMrkdwnToCardsHtml('docs at <https://example.com/x>')).toBe(
      'docs at <a href="https://example.com/x">https://example.com/x</a>',
    );
  });

  it('escapes stray HTML metacharacters so user content cannot inject tags', () => {
    expect(slackMrkdwnToCardsHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('rejects non-http(s) link hrefs to block javascript: smuggling', () => {
    // The link regex matches only http(s), so a javascript: URL never
    // becomes an `<a href>` — it gets HTML-escaped as plain text, which
    // Cards v2 will render as harmless visible characters.
    const out = slackMrkdwnToCardsHtml('<javascript:alert(1)|bad>');
    expect(out).not.toMatch(/<a\b[^>]*href=/);
    expect(out).toContain('&lt;javascript:alert(1)|bad&gt;');
  });

  it('preserves headers + bullets line structure across formatting', () => {
    const input = '*🧭 What it is*\n- Bullet about *bold thing*';
    const out = slackMrkdwnToCardsHtml(input);
    expect(out).toContain('<b>🧭 What it is</b>');
    expect(out).toContain('<b>bold thing</b>');
    expect(out).toContain('\n- Bullet');
  });
});
