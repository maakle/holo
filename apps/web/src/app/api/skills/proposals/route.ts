import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
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
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_NOT_FOUND'
            ? 404
            : e.code === 'HOLO_INVALID_INPUT'
              ? 400
              : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
