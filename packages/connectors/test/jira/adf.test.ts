import { describe, it, expect } from 'vitest';
import { adfToPlainText } from '../../src/jira/adf';

describe('adfToPlainText', () => {
  it('returns empty string for null / undefined / non-object input', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
    expect(adfToPlainText('not adf')).toBe('');
    expect(adfToPlainText({})).toBe('');
  });

  it('renders a single paragraph with inline text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Hello world');
  });

  it('separates paragraphs with a blank line', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('First\n\nSecond');
  });

  it('prefixes headings with # markers by level', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Top' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
        { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Deep' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('# Top\n\n## Sub\n\n###### Deep');
  });

  it('renders bullet lists with "- " prefix', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('- one\n- two');
  });

  it('renders ordered lists with "1. " "2. " prefixes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('1. one\n2. two');
  });

  it('fences code blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('```ts\nconst x = 1;\n```');
  });

  it('renders hardBreak as a newline within a paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line2' },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('line1\nline2');
  });

  it('renders mentions as @DisplayName', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'cc ' },
            { type: 'mention', attrs: { text: '@Jane Doe', id: 'abc' } },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('cc @Jane Doe');
  });

  it('substitutes placeholders for media and table nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'mediaSingle',
          content: [{ type: 'media', attrs: { alt: 'diagram.png' } }],
        },
        { type: 'table', content: [] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('[image: diagram.png]\n\n[table]');
  });

  it('falls back to recursing into content for unknown node types', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'someFutureNodeType',
          content: [{ type: 'text', text: 'still extracted' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('still extracted');
  });

  it('trims leading and trailing whitespace from the final result', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'paragraph', content: [] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('body');
  });
});
