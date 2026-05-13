import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { fingerprintSkill, parseSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { canManageSkills, resolveMemberRole } from '@/app/(app)/skills/_lib/permissions';

/**
 * Autosave for the skill editor. Owner/admin only for *active* skills; the
 * fork owner (creator) can edit their own *draft* regardless of role. This
 * mirrors the RFC-0005 permissions matrix: "Edit-active = owner/admin;
 * fork-then-edit = anyone".
 */
export async function PATCH(
  req: Request,
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

    const rows = await db
      .select()
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

    const isCreator = target.createdBy === session.user.id;
    const canEdit =
      target.status === 'active'
        ? canManageSkills(role)
        : canManageSkills(role) || isCreator;
    if (!canEdit) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem:
          target.status === 'active'
            ? 'editing an active skill requires owner or admin role'
            : 'only the draft owner or an admin can edit this draft',
        fix:
          target.status === 'active'
            ? 'Fork the skill first, then edit your fork.'
            : 'Ask the draft owner to share their fork or fork it again.',
      });
    }

    const body = (await req.json().catch(() => ({}))) as { content?: string };
    if (typeof body.content !== 'string' || body.content.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'missing "content" string',
        fix: 'Send a JSON body with a non-empty "content" field.',
      });
    }
    // Server-side parse guard — we should never persist YAML that the
    // orchestrator can't read.
    try {
      parseSkill(body.content);
    } catch (e) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `invalid skill YAML: ${e instanceof Error ? e.message : String(e)}`,
        fix: 'Fix the YAML error before saving.',
      });
    }

    const now = new Date();
    await db
      .update(schema.skills)
      .set({
        content: body.content,
        fingerprint: fingerprintSkill(body.content),
        updatedBy: session.user.id,
        updatedAt: now,
      })
      .where(eq(schema.skills.id, target.id));

    // Audit log every save — these are the keystrokes that change shipped
    // behaviour. RFC-0005: "Audit log entries: skill.fork, skill.edit,
    // skill.promote, skill.archive."
    emitAuditEvent({
      db,
      organizationId: orgId,
      userId: session.user.id,
      eventType: 'skill.edit',
      resourceType: 'skill',
      resourceId: target.id,
      meta: { slug, fingerprint: fingerprintSkill(body.content) },
    });

    return NextResponse.json({ id: target.id, slug, updatedAt: now.toISOString() });
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
