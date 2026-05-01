import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { redactSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured',
        fix: 'Add ANTHROPIC_API_KEY to your .env file.',
      });
    }

    const { id: skillId } = await params;

    // Fetch the skill and verify it belongs to this org
    const [skill] = await db
      .select({ id: schema.skills.id, content: schema.skills.content, organizationId: schema.skills.organizationId })
      .from(schema.skills)
      .where(and(eq(schema.skills.id, skillId), eq(schema.skills.organizationId, defaultOrgId)))
      .limit(1);

    if (!skill) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `Skill "${skillId}" not found in your organization`,
        fix: 'Verify the skill ID is correct.',
      });
    }

    // Check if already published
    const [existing] = await db
      .select({ id: schema.publishedSkills.id })
      .from(schema.publishedSkills)
      .where(eq(schema.publishedSkills.skillId, skillId))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: 'already_published' }, { status: 409 });
    }

    // Redact the skill content via Claude
    const redactedContent = await redactSkill(skill.content, apiKey);

    // Insert into publishedSkills
    const [inserted] = await db
      .insert(schema.publishedSkills)
      .values({
        organizationId: defaultOrgId,
        skillId,
        redactedContent,
      })
      .returning({ id: schema.publishedSkills.id });

    if (!inserted) {
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: 'Insert did not return a row',
        fix: 'Retry the publish operation.',
      });
    }
    return NextResponse.json({ publishedId: inserted.id });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_NOT_FOUND'
            ? 404
            : e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
              ? 400
              : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
