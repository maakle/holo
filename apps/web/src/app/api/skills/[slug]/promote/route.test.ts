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
  canManageSkills: (role: string | null) => role === 'owner' || role === 'admin',
}));

const emitAuditEventMock = vi.fn();
vi.mock('@holo/audit', () => ({ emitAuditEvent: (...args: unknown[]) => emitAuditEventMock(...args) }));

import { POST } from './route';

const DRAFT = {
  id: 'skill-1',
  organizationId: 'org-1',
  slug: 'demo',
  name: 'demo',
  version: 1,
  status: 'draft' as const,
  content: '---\nname: demo\ndescription: d\ntools: []\n---\nBody.\n',
};

function db() {
  const fromObj = {
    where: () => fromObj,
    orderBy: () => fromObj,
    limit: () => Promise.resolve([DRAFT]),
  };
  const updateObj = {
    set: () => updateObj,
    where: () => Promise.resolve(undefined),
  };
  return {
    select: () => ({ from: () => fromObj }),
    update: () => updateObj,
  };
}

function makeAuth() {
  return {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'user-me' },
        session: { activeOrganizationId: 'org-1' },
      })),
    },
  };
}

function req() {
  return new Request('http://localhost/api/skills/demo/promote', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/skills/[slug]/promote', () => {
  it('BLOCKS a member with 403 (permission middleware enforced)', async () => {
    getServerContextMock.mockResolvedValue({ db: db(), auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('member');
    const res = await POST(req(), { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(403);
    expect(emitAuditEventMock).not.toHaveBeenCalled();
  });

  it('allows an admin and emits skill.promote audit event', async () => {
    getServerContextMock.mockResolvedValue({ db: db(), auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('admin');
    const res = await POST(req(), { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(200);
    expect(emitAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'skill.promote', resourceId: 'skill-1' }),
    );
  });

  it('allows an owner', async () => {
    getServerContextMock.mockResolvedValue({ db: db(), auth: makeAuth() });
    resolveMemberRoleMock.mockResolvedValue('owner');
    const res = await POST(req(), { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(200);
  });

  it('returns 401 when unauthenticated', async () => {
    const auth = makeAuth();
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    getServerContextMock.mockResolvedValue({ db: db(), auth });
    const res = await POST(req(), { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(401);
  });
});
