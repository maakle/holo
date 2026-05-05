import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { hasSlackBotScopes } from '@holo/connectors';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

/**
 * Reports whether the org's Slack connection has the bot scopes (mentions,
 * DMs, slash commands, chat:write). Drives the "Enable @holo bot" prompt on
 * the Connections page and the "Connect agent → Slack" tab. Returns:
 *
 *   - status: 'not_connected' — no Slack credentials at all
 *   - status: 'ingest_only'   — connected but missing app_mentions:read etc.
 *   - status: 'bot_enabled'   — has bot scopes; bot is live
 */
export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId =
      (session.user as unknown as { organizationId?: string }).organizationId ?? defaultOrgId;

    const rows = await db
      .select({ scope: schema.connectorCredentials.scope })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.provider, 'slack'),
          eq(schema.connectorCredentials.status, 'active'),
        ),
      );

    if (rows.length === 0) {
      return NextResponse.json({ status: 'not_connected' as const });
    }
    // If ANY active credential row in the org has bot scopes, the workspace
    // can serve bot traffic — the events worker picks the most-recent active
    // token regardless of which user authorized it.
    const botEnabled = rows.some((r) => hasSlackBotScopes(r.scope));
    return NextResponse.json({
      status: botEnabled ? ('bot_enabled' as const) : ('ingest_only' as const),
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
