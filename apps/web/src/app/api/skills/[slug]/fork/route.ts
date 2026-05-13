import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { fingerprintSkill, parseSkill, serializeSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { canViewSkills, resolveMemberRole } from '@/app/(app)/skills/_lib/permissions';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function POST(
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
    if (!canViewSkills(role)) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'fork requires workspace membership',
        fix: 'Ask an admin to add you to this workspace.',
      });
    }

    const body = (await req.json().catch(() => ({}))) as { suffix?: string };
    const suffix = (body.suffix ?? '').trim().toLowerCase().replace(/^-+/, '');
    if (!suffix || !/^[a-z0-9-]{1,32}$/.test(suffix)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `invalid fork suffix "${suffix}"`,
        fix: 'Use 1–32 lowercase letters, digits, or hyphens.',
      });
    }

    // Load the latest version of the parent slug.
    const parentRows = await db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, slug)))
      .orderBy(desc(schema.skills.version))
      .limit(1);
    const parent = parentRows[0];
    if (!parent) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: `skill "${slug}" not found` },
        { status: 404 },
      );
    }

    // Compose new slug. If a fork with that slug already exists (org-scoped),
    // surface the collision rather than silently bumping — the user picked
    // the suffix, so they're best positioned to disambiguate.
    const newSlug = `${parent.slug}-${suffix}`;
    if (!SLUG_RE.test(newSlug)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `computed slug "${newSlug}" is invalid`,
        fix: 'Pick a shorter suffix or rename the parent.',
      });
    }
    const collision = await db
      .select({ id: schema.skills.id })
      .from(schema.skills)
      .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, newSlug)))
      .limit(1);
    if (collision.length > 0) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `a skill with slug "${newSlug}" already exists`,
        fix: 'Pick a different fork suffix.',
      });
    }

    // Re-serialize the YAML with the new name so the fork is distinguishable
    // in form mode. If the source fails to parse we keep the raw content as-is.
    let content = parent.content;
    try {
      const doc = parseSkill(parent.content);
      content = serializeSkill({
        ...doc,
        frontmatter: { ...doc.frontmatter, name: newSlug },
      });
    } catch {
      // tolerate parse failure on the source — the fork will inherit it.
    }

    const [inserted] = await db
      .insert(schema.skills)
      .values({
        organizationId: orgId,
        slug: newSlug,
        name: newSlug,
        version: 1,
        status: 'draft',
        content,
        fingerprint: fingerprintSkill(content),
        createdBy: session.user.id,
        updatedBy: session.user.id,
        parentSkillId: parent.id,
        toolAllowlist: parent.toolAllowlist ?? [],
        executable: parent.executable,
      })
      .returning({ id: schema.skills.id, slug: schema.skills.slug });

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId: session.user.id,
      eventType: 'skill.fork',
      resourceType: 'skill',
      resourceId: inserted!.id,
      meta: { parentId: parent.id, parentSlug: parent.slug, newSlug: inserted!.slug },
    });

    return NextResponse.json({ id: inserted!.id, slug: inserted!.slug }, { status: 201 });
  } catch (e) {
    if (e instanceof HoloError) {
      const status = e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : e.code === 'HOLO_AUTH_FORBIDDEN' ? 403 : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
