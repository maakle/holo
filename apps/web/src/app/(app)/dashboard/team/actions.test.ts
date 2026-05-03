import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/server-context', () => ({
  getServerContext: vi.fn(() =>
    Promise.reject(
      new Error('server context should not be reached for invalid input'),
    ),
  ),
}));

import { inviteMember } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('inviteMember', () => {
  it('returns an error and does not hit server context for malformed email', async () => {
    const result = await inviteMember(fd({ email: 'nope', role: 'member' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
  });

  it('returns an error for an unknown role', async () => {
    const result = await inviteMember(fd({ email: 'a@b.io', role: 'superuser' }));
    expect(result.ok).toBe(false);
  });
});
