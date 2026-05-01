import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and, desc } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getArtifact } from '@holo/retrieval-core';
import { synthesizeSkill, fingerprintSkill, serializeSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured',
        fix: 'Add ANTHROPIC_API_KEY to your .env file.',
      });
    }

    const body = (await req.json().catch(() => null)) as { skillSlug?: string } | null;
    if (!body?.skillSlug?.trim()) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'skillSlug is required',
        fix: 'Provide a skillSlug in the request body.',
      });
    }
    const skillSlug = body.skillSlug.trim();

    // Fetch all labels for this slug in this org
    const labelRows = await db
      .select({ sourceArtifactId: schema.skillLabels.sourceArtifactId })
      .from(schema.skillLabels)
      .where(
        and(
          eq(schema.skillLabels.organizationId, orgId),
          eq(schema.skillLabels.skillSlug, skillSlug),
        ),
      );

    if (labelRows.length < 2) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Need at least 2 labeled artifacts to synthesize "${skillSlug}" (found ${labelRows.length})`,
        fix: 'Label at least 2 example artifacts with this procedure name first.',
      });
    }

    // Reassemble each artifact's ordered chunk content
    const labeledArtifacts = await Promise.all(
      labelRows.map(async (l) => {
        const { ordered, artifactKind } = await getArtifact({
          db,
          artifactId: l.sourceArtifactId,
          organizationId: orgId,
        });
        const content = ordered.map((c) => c.content).join('\n\n');
        return { artifactId: l.sourceArtifactId, kind: artifactKind, content };
      }),
    );

    // Call Claude for synthesis
    const skillDoc = await synthesizeSkill({ skillSlug, labeledArtifacts, apiKey });
    const content = serializeSkill(skillDoc);
    const fingerprint = fingerprintSkill(content);

    // Upsert: update existing active skill, or insert new one
    const existing = await db
      .select({ id: schema.skills.id })
      .from(schema.skills)
      .where(
        and(
          eq(schema.skills.organizationId, orgId),
          eq(schema.skills.slug, skillSlug),
          eq(schema.skills.status, 'active'),
        ),
      )
      .orderBy(desc(schema.skills.version))
      .limit(1);

    let skillId: string;
    if (existing[0]) {
      await db
        .update(schema.skills)
        .set({ content, fingerprint, updatedAt: new Date(), name: skillDoc.frontmatter.name })
        .where(eq(schema.skills.id, existing[0].id));
      skillId = existing[0].id;
    } else {
      const [inserted] = await db
        .insert(schema.skills)
        .values({
          organizationId: orgId,
          name: skillDoc.frontmatter.name,
          slug: skillSlug,
          version: 1,
          status: 'active',
          content,
          fingerprint,
          createdBy: userId,
          sourceArtifactIds: labelRows.map((l) => l.sourceArtifactId),
        })
        .returning({ id: schema.skills.id });
      skillId = inserted!.id;
    }

    return NextResponse.json({ ok: true, skillId, slug: skillSlug });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
