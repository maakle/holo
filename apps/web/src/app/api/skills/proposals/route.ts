import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';

export async function GET() {
  const { auth, db, defaultOrgId } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = defaultOrgId;

  const rows = await db
    .select({
      id: schema.procedureProposals.id,
      proposedSlug: schema.procedureProposals.proposedSlug,
      proposedName: schema.procedureProposals.proposedName,
      summary: schema.procedureProposals.summary,
      createdAt: schema.procedureProposals.createdAt,
      episodeId: schema.procedureProposals.episodeId,
      artifactIds: schema.procedureEpisodes.sourceArtifactIds,
      entityKey: schema.procedureEpisodes.entityKey,
    })
    .from(schema.procedureProposals)
    .innerJoin(
      schema.procedureEpisodes,
      eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
    )
    .where(
      and(
        eq(schema.procedureProposals.organizationId, orgId),
        eq(schema.procedureProposals.status, 'pending'),
      ),
    )
    .orderBy(desc(schema.procedureProposals.createdAt))
    .limit(20);

  return NextResponse.json({ proposals: rows });
}
