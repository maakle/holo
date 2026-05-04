import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

const PROVIDERS = new Set(['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'] as const);
type Provider = typeof PROVIDERS extends Set<infer T> ? T : never;

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!PROVIDERS.has(rawProvider as Provider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${rawProvider}'`,
        fix: 'Use one of: github, slack, notion, grain, pylon, hubspot.',
      });
    }
    const provider = rawProvider as Provider;

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
    const userId = session.user.id;

    // GitHub uses an org-level App installation, not per-user credentials.
    // Local cleanup only — Phase 5 will add the call to GitHub's
    // DELETE /app/installations/{id} endpoint to uninstall remotely.
    if (provider === 'github') {
      const deletedInstalls = await db
        .delete(schema.githubInstallations)
        .where(eq(schema.githubInstallations.organizationId, orgId))
        .returning({ id: schema.githubInstallations.id });
      const deletedSources = await db
        .delete(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, 'github'),
          ),
        )
        .returning({ id: schema.sources.id });
      const deletedAllow = await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.organizationId, orgId),
            eq(schema.connectorAllowlists.provider, 'github'),
          ),
        )
        .returning({ id: schema.connectorAllowlists.id });
      return NextResponse.json({
        ok: true,
        removedInstallations: deletedInstalls.length,
        removedSources: deletedSources.length,
        removedAllowlistRows: deletedAllow.length,
      });
    }

    // Mark this user's credential revoked. Other users in the same org keep theirs.
    await db
      .update(schema.connectorCredentials)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, provider),
        ),
      );

    // If no active credentials remain for this org+provider, tear down sources +
    // allowlist so future scheduler boots stop syncing this provider. This
    // cascades through source_artifacts → chunks via FK onDelete cascade.
    const remaining = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.provider, provider),
          eq(schema.connectorCredentials.status, 'active'),
        ),
      );

    let removedSources = 0;
    let removedAllowlistRows = 0;
    if (remaining.length === 0) {
      const deletedSources = await db
        .delete(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, provider),
          ),
        )
        .returning({ id: schema.sources.id });
      removedSources = deletedSources.length;

      const deletedAllow = await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.organizationId, orgId),
            eq(schema.connectorAllowlists.provider, provider),
          ),
        )
        .returning({ id: schema.connectorAllowlists.id });
      removedAllowlistRows = deletedAllow.length;
    }

    return NextResponse.json({
      ok: true,
      removedSources,
      removedAllowlistRows,
      remainingCredentials: remaining.length,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
