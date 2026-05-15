import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Reports the readiness of the shared Holo Google Chat App for the active
 * org. Three states, mirroring the Slack bot-status shape:
 *
 *   - not_configured     — operator hasn't set GOOGLE_CHAT_APP_PROJECT_NUMBER +
 *                          GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON on the
 *                          gateway/worker, so no inbound event can be
 *                          verified or replied to.
 *   - workspace_unclaimed — env vars are set, but this org has no row in
 *                           google_chat_workspaces, so inbound events from
 *                           a Workspace cannot resolve to this org.
 *   - bot_enabled         — env configured AND this org has claimed a
 *                           Workspace; bot will reply.
 *
 * `customerNumber` is returned in the claimed state so the UI can show it.
 */
export async function GET() {
  try {
    const { env, db, auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    const gatewayBase = env.MCP_PUBLIC_URL?.replace(/\/+$/, '') ?? null;
    const eventsUrl = gatewayBase ? `${gatewayBase}/google-chat-app/events` : null;

    const envReady = Boolean(
      env.GOOGLE_CHAT_APP_PROJECT_NUMBER && env.GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON,
    );
    if (!envReady) {
      return NextResponse.json({ status: 'not_configured' as const, eventsUrl });
    }

    const rows = await db
      .select({ customerNumber: schema.googleChatWorkspaces.customerNumber })
      .from(schema.googleChatWorkspaces)
      .where(eq(schema.googleChatWorkspaces.organizationId, orgId))
      .limit(1);

    const first = rows[0];
    if (!first) {
      return NextResponse.json({ status: 'workspace_unclaimed' as const });
    }

    return NextResponse.json({
      status: 'bot_enabled' as const,
      customerNumber: first.customerNumber,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
