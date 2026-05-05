import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { synthesizeAndPersist } from '@/lib/synthesize-and-persist';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const userId = session.user.id;
    const { id: proposalId } = await params;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured',
        fix: 'Add ANTHROPIC_API_KEY to your .env file.',
      });
    }

    const body = (await req.json().catch(() => null)) as { finalSlug?: string } | null;

    // Look up the proposal joined to its episode
    const proposalRows = await db
      .select({
        id: schema.procedureProposals.id,
        organizationId: schema.procedureProposals.organizationId,
        proposedSlug: schema.procedureProposals.proposedSlug,
        status: schema.procedureProposals.status,
        artifactIds: schema.procedureEpisodes.sourceArtifactIds,
      })
      .from(schema.procedureProposals)
      .innerJoin(
        schema.procedureEpisodes,
        eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
      )
      .where(
        and(
          eq(schema.procedureProposals.id, proposalId),
          eq(schema.procedureProposals.organizationId, orgId),
        ),
      )
      .limit(1);

    const proposal = proposalRows[0];
    if (!proposal || proposal.status !== 'pending') {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'Proposal not found or is not pending',
        fix: 'Check the proposal ID and ensure it is still pending.',
      });
    }

    const finalSlug = (body?.finalSlug ?? proposal.proposedSlug)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');

    // Transaction: insert labels, update proposal status, insert decision
    await db.transaction(async (tx) => {
      // Insert skill_labels for each artifactId pointing at finalSlug
      await tx
        .insert(schema.skillLabels)
        .values(
          proposal.artifactIds.map((artifactId) => ({
            organizationId: orgId,
            userId,
            sourceArtifactId: artifactId,
            skillSlug: finalSlug,
          })),
        )
        .onConflictDoNothing();

      // Update proposal status → 'accepted'
      await tx
        .update(schema.procedureProposals)
        .set({ status: 'accepted' })
        .where(eq(schema.procedureProposals.id, proposalId));

      // Insert decision row
      await tx.insert(schema.procedureProposalDecisions).values({
        organizationId: orgId,
        proposalId,
        decision: 'accept',
        finalSlug,
        decidedBy: userId,
      });
    });

    // After commit, synthesize and persist the skill
    const { skillId } = await synthesizeAndPersist({ db, orgId, userId, skillSlug: finalSlug, apiKey });

    return NextResponse.json({ skillId, slug: finalSlug });
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
