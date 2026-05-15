import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Claim an Azure AD tenant for the active org. Inbound Teams activities
 * carry `channelData.tenant.id` (a GUID) in every payload; the worker
 * resolves it to a Holo org via `teams_installations`. Without a row
 * here the bot stays silent — this route is how an admin registers
 * their tenant.
 *
 * `tenant_id` is `UNIQUE` at the DB level (one tenant ↔ exactly one
 * Holo org for now), so a conflict here means another org already
 * claimed it. Surface as 409 rather than overwriting.
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
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

    let body: { tenantId?: unknown; tenantDisplayName?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'request body must be JSON',
        fix: 'POST { "tenantId": "<AAD tenant GUID>", "tenantDisplayName"?: "<display>" }',
      });
    }

    const tenantId =
      typeof body.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';
    if (!GUID_RE.test(tenantId)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'tenantId must be an Azure AD tenant GUID',
        fix: 'Copy it from portal.azure.com → Azure Active Directory → Overview → Tenant ID.',
      });
    }
    const tenantDisplayName =
      typeof body.tenantDisplayName === 'string' && body.tenantDisplayName.trim()
        ? body.tenantDisplayName.trim().slice(0, 200)
        : null;

    try {
      await db
        .insert(schema.teamsInstallations)
        .values({
          organizationId: orgId,
          tenantId,
          ...(tenantDisplayName !== null ? { tenantDisplayName } : {}),
        })
        .onConflictDoNothing({
          target: schema.teamsInstallations.tenantId,
        });
    } catch (err) {
      console.error('teams-bot claim insert failed', err);
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: 'failed to register tenant',
        fix: 'Retry; if it persists check worker logs.',
      });
    }

    // Verify the row landed under THIS org — if onConflictDoNothing fired
    // because another org already owns this tenant_id, return 409.
    const rows = await db
      .select({ organizationId: schema.teamsInstallations.organizationId })
      .from(schema.teamsInstallations)
      .where(eq(schema.teamsInstallations.tenantId, tenantId))
      .limit(1);
    if (!rows[0] || rows[0].organizationId !== orgId) {
      return NextResponse.json(
        {
          problem: 'this Azure AD tenant is already linked to another Holo org',
          fix: 'Unlink it from the other org first, or contact support.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, tenantId });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

/**
 * Unlink a tenant from this org. The bot stops replying in that tenant
 * (events from it will fail tenant→org resolution), and the row is
 * freed for another org to claim if needed.
 */
export async function DELETE(req: Request) {
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

    const url = new URL(req.url);
    const tenantId = (url.searchParams.get('tenantId') ?? '').toLowerCase();
    if (!GUID_RE.test(tenantId)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'tenantId query parameter must be an AAD tenant GUID',
        fix: 'DELETE /api/connectors/teams-bot/claim?tenantId=<guid>',
      });
    }

    // Only delete rows that belong to the active org. A foreign-org row
    // is invisible to this user — we silently ack to avoid confirming
    // its existence.
    await db
      .delete(schema.teamsInstallations)
      .where(
        and(
          eq(schema.teamsInstallations.tenantId, tenantId),
          eq(schema.teamsInstallations.organizationId, orgId),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
