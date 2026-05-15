import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, count } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Reports the readiness of the shared Holo Microsoft Teams bot for the
 * active org. Three states, mirroring the Slack + Google Chat shape:
 *
 *   - not_configured     — operator hasn't set TEAMS_BOT_APP_ID +
 *                          TEAMS_BOT_APP_SECRET on the gateway/
 *                          worker, so no inbound activity can be verified
 *                          or replied to. The dashboard surfaces
 *                          the Azure registration runbook in this state.
 *   - tenant_unclaimed   — env vars are set, but this org has no row in
 *                          `teams_installations`, so inbound activities
 *                          from an AAD tenant cannot resolve to this org.
 *   - bot_enabled        — env configured AND this org has at least one
 *                          claimed tenant; bot will reply in those
 *                          tenants.
 *
 * `installationCount` is returned in the enabled state so the UI can
 * show "Installed in N tenants".
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

    const envReady = Boolean(
      env.TEAMS_BOT_APP_ID && env.TEAMS_BOT_APP_SECRET,
    );
    if (!envReady) {
      return NextResponse.json({ status: 'not_configured' as const });
    }

    const rows = await db
      .select({ count: count() })
      .from(schema.teamsInstallations)
      .where(eq(schema.teamsInstallations.organizationId, orgId));
    const installationCount = rows[0]?.count ?? 0;

    if (installationCount === 0) {
      return NextResponse.json({ status: 'tenant_unclaimed' as const });
    }
    return NextResponse.json({
      status: 'bot_enabled' as const,
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
