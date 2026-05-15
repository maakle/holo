import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and, count } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Status probe for Teams ingestion. Four states, ordered roughly by
 * setup-step the admin needs to take to advance:
 *
 *   - `not_configured` — operator hasn't set `TEAMS_BOT_APP_ID` /
 *     `TEAMS_BOT_APP_SECRET` on the worker. Surfaces the Azure
 *     registration runbook.
 *   - `bot_not_installed` — env set, but the bot hasn't received any
 *     inbound activity from a tenant yet (no `teams_installations`
 *     rows for this org). Customer needs to sideload `holo-bot.zip`
 *     and add the bot to a team or chat first. Surfaces the bot
 *     install flow.
 *   - `ready_to_enable` — env set, bot installed in ≥1 tenant, but the
 *     ingestion `connector_credentials` row hasn't been created yet.
 *     Surfaces an "Enable ingestion" button.
 *   - `enabled` — `connector_credentials` row exists; the standard
 *     scheduler runs the sync.
 *
 * `installationCount` returned in `bot_not_installed` and beyond so the
 * UI can show "N tenants installed".
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

    if (!env.TEAMS_BOT_APP_ID || !env.TEAMS_BOT_APP_SECRET) {
      return NextResponse.json({ status: 'not_configured' as const });
    }

    const installRow = await db
      .select({ count: count() })
      .from(schema.teamsInstallations)
      .where(eq(schema.teamsInstallations.organizationId, orgId));
    const installationCount = installRow[0]?.count ?? 0;

    if (installationCount === 0) {
      return NextResponse.json({
        status: 'bot_not_installed' as const,
        installationCount: 0,
      });
    }

    const credRow = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.provider, 'teams'),
        ),
      )
      .limit(1);

    if (!credRow[0]) {
      return NextResponse.json({
        status: 'ready_to_enable' as const,
        installationCount,
      });
    }

    return NextResponse.json({
      status: 'enabled' as const,
      installationCount,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
