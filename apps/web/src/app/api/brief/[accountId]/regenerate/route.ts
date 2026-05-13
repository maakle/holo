/**
 * Thin web-side endpoint for the regenerate button. Mirrors
 * `POST /v1/accounts/:accountId/brief/regenerate` in the gateway but uses
 * the better-auth session cookie rather than a bearer token, so the page
 * doesn't need to round-trip through token issuance.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  runGetAccountBriefTool,
  invalidateAccountBriefCache,
  BRIEF_CONTEXTS,
  type BriefContext,
} from '@holo/agent-tools';
import { getSubjectsForUser } from '@holo/user-subjects';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ problem: 'Not signed in' }, { status: 401 });
  }
  const orgId = resolveActiveOrgId(session);
  if (!orgId) {
    return NextResponse.json({ problem: 'No active organization' }, { status: 401 });
  }

  const { accountId } = await ctx.params;
  const url = new URL(req.url);
  const rawContext = url.searchParams.get('context') ?? 'check-in';
  const customContext = url.searchParams.get('customContext') ?? undefined;
  const allowed = new Set<string>(BRIEF_CONTEXTS as readonly string[]);
  if (!allowed.has(rawContext)) {
    return NextResponse.json(
      { problem: `Invalid context: ${rawContext}` },
      { status: 400 },
    );
  }
  const context = rawContext as BriefContext;

  await invalidateAccountBriefCache({ db, organizationId: orgId, accountId, context });

  const extraSubjects = await getSubjectsForUser(db, session.user.id);
  const brief = await runGetAccountBriefTool(
    {
      db,
      organizationId: orgId,
      userId: session.user.id,
      userSubjects: [`org:${orgId}`, `user:${session.user.id}`, ...extraSubjects],
    },
    {
      account_id: accountId,
      context,
      ...(customContext ? { custom_context: customContext } : {}),
    },
  );

  if (brief.sections.atGlance.displayName === '') {
    return NextResponse.json(
      { problem: 'Account not visible to this user' },
      { status: 403 },
    );
  }

  return NextResponse.json(brief);
}
