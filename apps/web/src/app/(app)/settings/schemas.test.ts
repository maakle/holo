import { describe, expect, it } from 'vitest';
import {
  updateWorkspaceSchema,
  workspaceNameSchema,
  workspaceSlugSchema,
} from './schemas';

describe('workspaceNameSchema', () => {
  it('trims and accepts a valid name', () => {
    const r = workspaceNameSchema.safeParse('  Acme Inc.  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('Acme Inc.');
  });

  it('rejects empty / whitespace-only names', () => {
    expect(workspaceNameSchema.safeParse('').success).toBe(false);
    expect(workspaceNameSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects names over 64 chars', () => {
    expect(workspaceNameSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });
});

describe('workspaceSlugSchema', () => {
  it('accepts lowercase letters, numbers, and hyphens', () => {
    expect(workspaceSlugSchema.safeParse('acme').success).toBe(true);
    expect(workspaceSlugSchema.safeParse('acme-co-2').success).toBe(true);
  });

  it('rejects uppercase, spaces, leading/trailing hyphens, double hyphens', () => {
    expect(workspaceSlugSchema.safeParse('Acme').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme co').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('-acme').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme-').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme--co').success).toBe(false);
  });

  it('rejects slugs over 48 chars', () => {
    expect(workspaceSlugSchema.safeParse('a'.repeat(49)).success).toBe(false);
  });
});

describe('updateWorkspaceSchema', () => {
  it('requires a uuid organizationId and a known field', () => {
    const ok = updateWorkspaceSchema.safeParse({
      organizationId: '00000000-0000-0000-0000-000000000000',
      field: 'name',
      value: 'Hello',
    });
    expect(ok.success).toBe(true);

    expect(
      updateWorkspaceSchema.safeParse({
        organizationId: 'not-a-uuid',
        field: 'name',
        value: 'x',
      }).success,
    ).toBe(false);

    expect(
      updateWorkspaceSchema.safeParse({
        organizationId: '00000000-0000-0000-0000-000000000000',
        field: 'logo',
        value: 'x',
      }).success,
    ).toBe(false);
  });
});
