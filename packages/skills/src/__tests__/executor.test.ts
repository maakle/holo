import { describe, it, expect } from 'vitest';
import { runSkillStep } from '../executor.js';

describe('runSkillStep', () => {
  it('extracts first action step from a skill body', () => {
    const body = `# Procedure\n\nStep 1: Call search with query "incident"\nStep 2: Summarize results`;
    const result = runSkillStep(body, 0);
    expect(result).not.toBeNull();
    expect(result!.stepText).toContain('Step 1');
    expect(result!.stepIndex).toBe(0);
  });

  it('extracts second step', () => {
    const body = `# Procedure\n\nStep 1: Do this\nStep 2: Do that\nStep 3: Done`;
    const result = runSkillStep(body, 1);
    expect(result).not.toBeNull();
    expect(result!.stepText).toContain('Step 2');
  });

  it('returns null for out-of-bounds step index', () => {
    const body = `# Procedure\n\nStep 1: Do something`;
    const result = runSkillStep(body, 5);
    expect(result).toBeNull();
  });
});
