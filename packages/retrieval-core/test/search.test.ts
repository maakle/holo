import { describe, it, expect } from 'vitest';
import { hybridSearch } from '../src/search';

const noopDb = {
  execute: async () => [],
} as unknown as Parameters<typeof hybridSearch>[0];

describe('hybridSearch validation', () => {
  it('throws HOLO_VALIDATION when query is empty', async () => {
    await expect(
      hybridSearch(noopDb, { query: '', organizationId: 'org-1' }),
    ).rejects.toMatchObject({ code: 'HOLO_VALIDATION' });
  });

  it('throws HOLO_VALIDATION when query is whitespace-only', async () => {
    await expect(
      hybridSearch(noopDb, { query: '   ', organizationId: 'org-1' }),
    ).rejects.toMatchObject({ code: 'HOLO_VALIDATION' });
  });

  it('throws HOLO_VALIDATION when organizationId is missing', async () => {
    await expect(
      hybridSearch(noopDb, { query: 'hello', organizationId: '' }),
    ).rejects.toMatchObject({ code: 'HOLO_VALIDATION' });
  });

  it('returns an empty array when DB returns no rows', async () => {
    const out = await hybridSearch(noopDb, { query: 'hello', organizationId: 'org-1' });
    expect(out).toEqual([]);
  });
});
