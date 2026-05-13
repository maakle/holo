import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { canManageSkills, resolveMemberRole } from '@/app/(app)/skills/_lib/permissions';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const role = await resolveMemberRole(db, orgId, session.user.id);
    if (!canManageSkills(role)) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'archive requires owner or admin role',
        fix: 'Ask a workspace owner/admin to archive this skill.',
      });
    }

    const rows = await db
      .select({ id: schema.skills.id })
      .from(schema.skills)
      .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, slug)))
      .orderBy(desc(schema.skills.version))
      .limit(1);
    const target = rows[0];
    if (!target) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: `skill "${slug}" not found` },
        { status: 404 },
      );
    }

    const now = new Date();
    await db
      .update(schema.skills)
      .set({ status: 'archived', archivedAt: now, updatedBy: session.user.id, updatedAt: now })
      .where(eq(schema.skills.id, target.id));

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId: session.user.id,
      eventType: 'skill.archive',
      resourceType: 'skill',
      resourceId: target.id,
      meta: { slug },
    });

    return NextResponse.json({ id: target.id, slug, archivedAt: now.toISOString() });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_AUTH_FORBIDDEN'
            ? 403
            : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
