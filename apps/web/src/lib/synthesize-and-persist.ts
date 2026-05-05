import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { synthesizeSkill, fingerprintSkill, serializeSkill } from '@holo/skills';
import { holoError, ErrorCode } from '@holo/errors';

export async function synthesizeAndPersist(opts: {
  db: DB;
  orgId: string;
  userId: string;
  skillSlug: string;
  apiKey: string;
}): Promise<{ skillId: string; slug: string }> {
  const { db, orgId, userId, skillSlug, apiKey } = opts;

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

  return { skillId, slug: skillSlug };
}
