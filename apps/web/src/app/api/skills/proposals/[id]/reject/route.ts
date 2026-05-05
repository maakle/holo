import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function POST(
  _req: Request,
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

    // Update proposal status → 'rejected' WHERE pending
    const updated = await db
      .update(schema.procedureProposals)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(schema.procedureProposals.id, proposalId),
          eq(schema.procedureProposals.organizationId, orgId),
          eq(schema.procedureProposals.status, 'pending'),
        ),
      )
      .returning({ id: schema.procedureProposals.id });

    if (updated.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'Proposal not found or is not pending',
        fix: 'Check the proposal ID and ensure it is still pending.',
      });
    }

    // Insert decision row
    await db.insert(schema.procedureProposalDecisions).values({
      organizationId: orgId,
      proposalId,
      decision: 'reject',
      finalSlug: null,
      decidedBy: userId,
    });

    return NextResponse.json({ ok: true });
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
