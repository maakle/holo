import { describe, it, expect } from 'vitest';
import { executeSkillInputSchema } from '@holo/agent-tools';

describe('executeSkillInputSchema', () => {
  it('accepts skillSlug + query', () => {
    const result = executeSkillInputSchema.safeParse({
      skillSlug: 'write-postmortem',
      query: 'P0 incident last night',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing query', () => {
    expect(executeSkillInputSchema.safeParse({ skillSlug: 'write-postmortem' }).success).toBe(false);
  });

  it('accepts optional version', () => {
    expect(executeSkillInputSchema.safeParse({
      skillSlug: 'write-postmortem',
      query: 'test',
      version: 2,
    }).success).toBe(true);
  });
});
