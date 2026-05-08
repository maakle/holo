import { describe, it, expect } from 'vitest';
import { parseSkill, serializeSkill, fingerprintSkill } from '../format';

const SAMPLE_SKILL = `---
name: handle-refund-request
description: Process customer refund requests through the support queue
tools:
  - search
  - get_ticket
when_to_use: When a customer contacts support requesting a refund or credit
---

# Procedure

Step 1: Search for the customer's ticket history using search.
Step 2: Retrieve the specific ticket with get_ticket.
Step 3: Check refund eligibility against policy.
Step 4: Process the refund or escalate if over $500.

## Examples

Customer requests refund for unused months after cancellation.
`;

describe('parseSkill', () => {
  it('parses frontmatter correctly', () => {
    const skill = parseSkill(SAMPLE_SKILL);
    expect(skill.frontmatter.name).toBe('handle-refund-request');
    expect(skill.frontmatter.description).toContain('refund');
    expect(skill.frontmatter.tools).toEqual(['search', 'get_ticket']);
    expect(skill.frontmatter.when_to_use).toContain('refund');
  });

  it('preserves procedure body', () => {
    const skill = parseSkill(SAMPLE_SKILL);
    expect(skill.body).toContain('Step 1:');
    expect(skill.body).toContain('Step 4:');
  });

  it('round-trips through serialize', () => {
    const skill = parseSkill(SAMPLE_SKILL);
    const reserialized = serializeSkill(skill);
    const reparsed = parseSkill(reserialized);
    expect(reparsed.frontmatter.name).toBe(skill.frontmatter.name);
    expect(reparsed.frontmatter.tools).toEqual(skill.frontmatter.tools);
  });

  it('throws on missing name', () => {
    expect(() => parseSkill('---\ndescription: no name\n---\n# Body\n')).toThrow('name');
  });

  it('throws on missing description', () => {
    expect(() => parseSkill('---\nname: test\n---\n# Body\n')).toThrow('description');
  });
});

describe('fingerprintSkill', () => {
  it('returns a 64-char hex string', () => {
    const fp = fingerprintSkill('hello world');
    expect(fp).toHaveLength(64);
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it('normalizes CRLF before hashing', () => {
    const fp1 = fingerprintSkill('hello\r\nworld');
    const fp2 = fingerprintSkill('hello\nworld');
    expect(fp1).toBe(fp2);
  });

  it('different content gives different fingerprint', () => {
    expect(fingerprintSkill('abc')).not.toBe(fingerprintSkill('xyz'));
  });
});
