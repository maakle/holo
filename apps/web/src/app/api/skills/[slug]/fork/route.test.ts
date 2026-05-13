import { describe, it, expect, vi, beforeEach } from 'vitest';

const headersMock = vi.fn(async () => new Headers());
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

const getServerContextMock = vi.fn();
vi.mock('@/lib/server-context', () => ({ getServerContext: () => getServerContextMock() }));

const resolveActiveOrgIdMock = vi.fn(() => 'org-1');
vi.mock('@/lib/active-org', () => ({ resolveActiveOrgId: () => resolveActiveOrgIdMock() }));

const resolveMemberRoleMock = vi.fn();
vi.mock('@/app/(app)/skills/_lib/permissions', () => ({
  resolveMemberRole: (...args: unknown[]) => resolveMemberRoleMock(...args),
  canViewSkills: (role: string | null) =>
    role === 'owner' || role === 'admin' || role === 'member',
  canManageSkills: (role: string | null) => role === 'owner' || role === 'admin',
}));

const emitAuditEventMock = vi.fn();
vi.mock('@holo/audit', () => ({ emitAuditEvent: (...args: unknown[]) => emitAuditEventMock(...args) }));

import { POST } from './route';

const SAMPLE_PARENT = {
  id: 'skill-parent',
  organizationId: 'org-1',
  slug: 'help-customer',
  name: 'help-customer',
  version: 1,
  status: 'active' as const,
  content: '---\nname: help-customer\ndescription: helps\ntools: []\n---\nBody.\n',
  fingerprint: 'fp',
  toolAllowlist: ['search'],
  executable: false,
  createdBy: 'user-other',
};

function dbWithParent({ collide = false }: { collide?: boolean } = {}) {
  // The route makes:
  //  1. parent lookup .select().from().where().orderBy().limit(1)
  //  2. collision .select().from().where().limit(1)
  //  3. insert .insert().values().returning()
  let selectCall = 0;
  const fromObj = {
    where: () => fromObj,
    orderBy: () => fromObj,
    limit: () => {
      selectCall += 1;
      if (selectCall === 1) return Promise.resolve([SAMPLE_PARENT]);
      // collision check
      if (collide) return Promise.resolve([{ id: 'existing' }]);
      return Promise.resolve([]);
    },
  };
  return {
    select: () => ({ from: () => fromObj }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'skill-fork', slug: 'help-customer-mine' }]),
      }),
    }),
  };
}

function makeAuth() {
  return {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'user-me', email: 'me@x' },
        session: { activeOrganizationId: 'org-1' },
      })),
    },
  };
}

function makeReq(body: unknown) {
  return new Request('http://localhost/api/skills/help-customer/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/skills/[slug]/fork', () => {
  it('creates a fork with parent_skill_id set and audit-logs skill.fork', async () => {
    const db = dbWithParent();
    getServerContextMock.mockResolvedValue({ db, auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('member');
    const res = await POST(makeReq({ suffix: 'mine' }), {
      params: Promise.resolve({ slug: 'help-customer' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe('help-customer-mine');
    expect(emitAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'skill.fork', resourceId: 'skill-fork' }),
    );
  });

  it('rejects an unauthenticated request with 401', async () => {
    const db = dbWithParent();
    const auth = makeAuth();
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    getServerContextMock.mockResolvedValue({ db, auth });
    const res = await POST(makeReq({ suffix: 'mine' }), {
      params: Promise.resolve({ slug: 'help-customer' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed suffix with 400', async () => {
    const db = dbWithParent();
    getServerContextMock.mockResolvedValue({ db, auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('member');
    const res = await POST(makeReq({ suffix: 'BAD SUFFIX!' }), {
      params: Promise.resolve({ slug: 'help-customer' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on slug collision', async () => {
    const db = dbWithParent({ collide: true });
    getServerContextMock.mockResolvedValue({ db, auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('member');
    const res = await POST(makeReq({ suffix: 'mine' }), {
      params: Promise.resolve({ slug: 'help-customer' }),
    });
    expect(res.status).toBe(400);
  });
});
