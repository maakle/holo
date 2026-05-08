import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveActiveOrgId } from './active-org';

describe('resolveActiveOrgId', () => {
  it('prefers session.activeOrganizationId over user home org', () => {
    expect(
      resolveActiveOrgId({
        user: { id: 'u1', organizationId: 'home-org' },
        session: { activeOrganizationId: 'active-org' },
      }),
    ).toBe('active-org');
  });

  it('falls back to user.organizationId when no active org is set', () => {
    expect(
      resolveActiveOrgId({
        user: { id: 'u1', organizationId: 'home-org' },
        session: {},
      }),
    ).toBe('home-org');
  });

  it('falls back to user.organizationId when activeOrganizationId is null', () => {
    expect(
      resolveActiveOrgId({
        user: { id: 'u1', organizationId: 'home-org' },
        session: { activeOrganizationId: null },
      }),
    ).toBe('home-org');
  });

  it('throws HOLO_AUTH_NO_ACTIVE_ORG when neither is set (no silent default-org fallback)', () => {
    expect(() =>
      resolveActiveOrgId({
        user: { id: 'u1' },
        session: {},
      }),
    ).toThrow(/HOLO_AUTH_NO_ACTIVE_ORG|no active workspace/);
  });
});
