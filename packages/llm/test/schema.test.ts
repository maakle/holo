import { describe, it, expect } from 'vitest';
import { flattenForAnthropic } from '../src/schema';

describe('flattenForAnthropic', () => {
  it('flattens anyOf union branches into a merged properties object', () => {
    const flat = flattenForAnthropic({
      anyOf: [
        { type: 'object', properties: { artifact_id: { type: 'string' } }, required: ['artifact_id'] },
        { type: 'object', properties: { notion_page_id: { type: 'string' } }, required: ['notion_page_id'] },
        { type: 'object', properties: { repo: { type: 'string' }, github_path: { type: 'string' } }, required: ['repo', 'github_path'] },
      ],
    });
    expect(flat).toEqual({
      type: 'object',
      properties: {
        artifact_id: { type: 'string' },
        notion_page_id: { type: 'string' },
        repo: { type: 'string' },
        github_path: { type: 'string' },
      },
    });
  });

  it('flattens oneOf and allOf the same way as anyOf', () => {
    const oneOf = flattenForAnthropic({
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    });
    expect(oneOf).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    });
    const allOf = flattenForAnthropic({
      allOf: [
        { type: 'object', properties: { c: { type: 'boolean' } } },
      ],
    });
    expect(allOf).toEqual({
      type: 'object',
      properties: { c: { type: 'boolean' } },
    });
  });

  it('passes a plain object schema through unchanged', () => {
    const schema = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    };
    expect(flattenForAnthropic(schema)).toEqual(schema);
  });

  it('coerces a missing type to type: "object"', () => {
    expect(flattenForAnthropic({ properties: {} })).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('treats non-object input as an empty object schema', () => {
    expect(flattenForAnthropic(null)).toEqual({ type: 'object' });
    expect(flattenForAnthropic(undefined)).toEqual({ type: 'object' });
    expect(flattenForAnthropic('garbage')).toEqual({ type: 'object' });
  });
});
