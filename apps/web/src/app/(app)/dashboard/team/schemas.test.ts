import { describe, expect, it } from 'vitest';
import { inviteMemberSchema, cancelInvitationSchema } from './schemas';

describe('inviteMemberSchema', () => {
  it('accepts a valid email and role, normalizing whitespace and case', () => {
    const r = inviteMemberSchema.safeParse({ email: '  A@B.io ', role: 'admin' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('a@b.io');
      expect(r.data.role).toBe('admin');
    }
  });

  it('rejects malformed emails', () => {
    const r = inviteMemberSchema.safeParse({ email: 'not-an-email', role: 'member' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown roles', () => {
    const r = inviteMemberSchema.safeParse({ email: 'x@y.io', role: 'superuser' });
    expect(r.success).toBe(false);
  });
});

describe('cancelInvitationSchema', () => {
  it('rejects empty invitation IDs', () => {
    const r = cancelInvitationSchema.safeParse({ invitationId: '' });
    expect(r.success).toBe(false);
  });

  it('accepts non-empty invitation IDs', () => {
    const r = cancelInvitationSchema.safeParse({ invitationId: 'inv_123' });
    expect(r.success).toBe(true);
  });
});
