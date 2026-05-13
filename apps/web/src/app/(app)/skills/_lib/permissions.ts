import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

export type MemberRole = 'owner' | 'admin' | 'member';

export interface SkillActorContext {
  role: MemberRole;
  userId: string;
}

/**
 * Look up the caller's role in the active workspace. Throws-via-redirect callers
 * should resolve `orgId` and `userId` first.
 */
export async function resolveMemberRole(
  db: DB,
  orgId: string,
  userId: string,
): Promise<MemberRole | null> {
  const rows = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  const role = rows[0]?.role as MemberRole | undefined;
  return role ?? null;
}

/** Owner or admin (manage permission on org-active skills). */
export function canManageSkills(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

/** Any member (view + fork). */
export function canViewSkills(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}
