import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { parseSkill } from '@holo/skills';
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
        problem: 'promote requires owner or admin role',
        fix: 'Ask a workspace owner/admin to promote this skill.',
      });
    }

    const latestRows = await db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, slug)))
      .orderBy(desc(schema.skills.version))
      .limit(1);
    const latest = latestRows[0];
    if (!latest) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: `skill "${slug}" not found` },
        { status: 404 },
      );
    }

    // Validate the content parses before promoting. We don't want an active
    // skill that fails parseSkill — the orchestrator would skip it silently.
    try {
      parseSkill(latest.content);
    } catch (e) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `skill YAML fails to parse: ${e instanceof Error ? e.message : String(e)}`,
        fix: 'Fix the YAML error in the editor before promoting.',
      });
    }

    // Move ALL prior active versions of this slug to archived (a skill has at
    // most one active version at a time), then bump version + set this one
    // active. The unique constraint is (org, slug, version) so we don't
    // collide.
    await db
      .update(schema.skills)
      .set({ status: 'archived', archivedAt: new Date(), updatedBy: session.user.id })
      .where(
        and(
          eq(schema.skills.organizationId, orgId),
          eq(schema.skills.slug, slug),
          eq(schema.skills.status, 'active'),
        ),
      );

    // The promoted row gets a fresh version number (highest + 1). If the
    // latest is already active we still bump, treating "promote" as "publish
    // the current draft state."
    const nextVersion = latest.version + 1;
    await db
      .update(schema.skills)
      .set({
        status: 'active',
        version: nextVersion,
        archivedAt: null,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.skills.id, latest.id));

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId: session.user.id,
      eventType: 'skill.promote',
      resourceType: 'skill',
      resourceId: latest.id,
      meta: { slug, fromVersion: latest.version, toVersion: nextVersion },
    });

    return NextResponse.json({ id: latest.id, slug, version: nextVersion });
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
