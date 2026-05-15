import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, desc } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * List Azure AD tenants currently linked to the active org. Surfaced on
 * the connections page so an admin can see which tenants the bot is
 * installed in and unlink one if needed.
 *
 * Returns most-recent-first to match the "what did I just add"
 * expectation; the table is small (one row per tenant the bot is in),
 * so no pagination.
 */
export async function GET() {
  try {
    const { db, auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    const rows = await db
      .select({
        tenantId: schema.teamsInstallations.tenantId,
        tenantDisplayName: schema.teamsInstallations.tenantDisplayName,
        installedAt: schema.teamsInstallations.installedAt,
      })
      .from(schema.teamsInstallations)
      .where(eq(schema.teamsInstallations.organizationId, orgId))
      .orderBy(desc(schema.teamsInstallations.installedAt));

    return NextResponse.json({
      installations: rows.map((r) => ({
        tenantId: r.tenantId,
        tenantDisplayName: r.tenantDisplayName,
        installedAt: r.installedAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
