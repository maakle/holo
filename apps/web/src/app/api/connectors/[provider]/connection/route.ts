import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  githubAppConfigFromEnv,
  uninstallApp,
  isGoogleServiceAccountProvider,
} from '@holo/connectors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  drainJobsForOrg,
  isSyncProvider,
  SYNC_PROVIDERS_FIX_HINT,
  type Provider,
} from '@/lib/sync-queue';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!isSyncProvider(rawProvider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${rawProvider}'`,
        fix: SYNC_PROVIDERS_FIX_HINT,
      });
    }
    const provider: Provider = rawProvider;

    const { auth, db, env} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    // GitHub uses an org-level App installation. Disconnect order matters:
    //   1. Read installation_id locally (we lose it once we delete the row).
    //   2. Tell GitHub to uninstall the App so it disappears from the
    //      admin's github.com/settings/installations page.
    //   3. Delete local rows (installation, sources, allowlist) regardless
    //      of whether the GitHub-side uninstall actually changed anything —
    //      a 404 from GitHub is treated as success (already gone).
    if (provider === 'github') {
      const installRows = await db
        .select({ installationId: schema.githubInstallations.installationId })
        .from(schema.githubInstallations)
        .where(eq(schema.githubInstallations.organizationId, orgId));

      let remoteUninstalled = 0;
      let remoteAlreadyGone = 0;
      for (const row of installRows) {
        try {
          const config = githubAppConfigFromEnv(env);
          const result = await uninstallApp({
            config,
            installationId: row.installationId,
          });
          if (result.uninstalled) remoteUninstalled += 1;
          else remoteAlreadyGone += 1;
        } catch (err) {
          // Don't let a remote failure block local cleanup — leaving stale
          // local state is worse than leaving the App installed on GitHub.
          // The admin can always uninstall from github.com/settings/installations.
          console.error(
            `[disconnect/github] uninstall ${row.installationId} failed:`,
            err,
          );
        }
      }

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
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId,
        eventType: 'connector.disconnected',
        resourceType: 'connector',
        resourceId: provider,
        meta: {
          provider,
          remoteUninstalled,
          remoteAlreadyGone,
          removedInstallations: deletedInstalls.length,
          removedSources: deletedSources.length,
          removedAllowlistRows: deletedAllow.length,
        },
      });
      return NextResponse.json({
        ok: true,
        remoteUninstalled,
        remoteAlreadyGone,
        removedInstallations: deletedInstalls.length,
        removedSources: deletedSources.length,
        removedAllowlistRows: deletedAllow.length,
      });
    }

    // Drain any waiting/delayed sync jobs for this org BEFORE we revoke the
    // token / delete the source. Otherwise a worker could pick one up after
    // the source row is gone and either run with a soon-to-be-invalid token
    // (Slack's account_inactive) or fail the sync_runs FK insert (every
    // other provider). Best-effort: a Redis blip shouldn't block disconnect.
    let drainedCounts: Record<string, number> | null = null;
    try {
      const { removed } = await drainJobsForOrg(provider, orgId);
      drainedCounts = removed;
    } catch (err) {
      console.error(`[disconnect/${provider}] drainJobsForOrg failed:`, err);
    }

    // Google service-account connectors store credentials in
    // `connector_service_accounts` (one row per org+provider, no userId).
    // Disconnect is a full tear-down: delete the SA row, sources, allowlist.
    // No remote uninstall — the SA itself lives in the customer's Google
    // Cloud project; we only revoke our access by dropping the key locally.
    if (isGoogleServiceAccountProvider(provider)) {
      const deletedSa = await db
        .delete(schema.connectorServiceAccounts)
        .where(
          and(
            eq(schema.connectorServiceAccounts.organizationId, orgId),
            eq(schema.connectorServiceAccounts.provider, provider),
          ),
        )
        .returning({ id: schema.connectorServiceAccounts.id });
      const deletedSources = await db
        .delete(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, provider),
          ),
        )
        .returning({ id: schema.sources.id });
      const deletedAllow = await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.organizationId, orgId),
            eq(schema.connectorAllowlists.provider, provider),
          ),
        )
        .returning({ id: schema.connectorAllowlists.id });
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId,
        eventType: 'connector.disconnected',
        resourceType: 'connector',
        resourceId: provider,
        meta: {
          provider,
          removedServiceAccounts: deletedSa.length,
          removedSources: deletedSources.length,
          removedAllowlistRows: deletedAllow.length,
        },
      });
      return NextResponse.json({
        ok: true,
        removedServiceAccounts: deletedSa.length,
        removedSources: deletedSources.length,
        removedAllowlistRows: deletedAllow.length,
        drainedJobs: drainedCounts,
      });
    }

    // Capture this user's still-valid token BEFORE we mark it revoked — we
    // may need it below to call Slack's apps.uninstall when this is the last
    // credential for the org. (Slack's revoke/uninstall calls require an
    // active bot token.)
    const tokenToUninstall =
      provider === 'slack'
        ? (
            await db
              .select({ accessToken: schema.connectorCredentials.accessToken })
              .from(schema.connectorCredentials)
              .where(
                and(
                  eq(schema.connectorCredentials.organizationId, orgId),
                  eq(schema.connectorCredentials.userId, userId),
                  eq(schema.connectorCredentials.provider, 'slack'),
                  eq(schema.connectorCredentials.status, 'active'),
                ),
              )
              .limit(1)
          )[0]?.accessToken ?? null
        : null;

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

    // For Slack, when the last user disconnects we also fully uninstall the
    // app from the workspace via apps.uninstall — that revokes the token,
    // removes the holo bot from every channel it joined, and removes the
    // app from the workspace's installed-apps list. Best-effort: a failure
    // here doesn't block local cleanup (matches the GitHub disconnect
    // policy at line ~64 above).
    let slackRemoteUninstalled: boolean | null = null;
    if (
      provider === 'slack' &&
      remaining.length === 0 &&
      tokenToUninstall &&
      env.SLACK_CONNECTOR_CLIENT_ID &&
      env.SLACK_CONNECTOR_CLIENT_SECRET
    ) {
      try {
        const params = new URLSearchParams({
          client_id: env.SLACK_CONNECTOR_CLIENT_ID,
          client_secret: env.SLACK_CONNECTOR_CLIENT_SECRET,
        });
        const res = await fetch(
          `https://slack.com/api/apps.uninstall?${params.toString()}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${tokenToUninstall}` },
          },
        );
        const json = (await res.json()) as { ok: boolean; error?: string };
        slackRemoteUninstalled = json.ok;
        if (!json.ok) {
          console.error(
            `[disconnect/slack] apps.uninstall returned not-ok: ${json.error}`,
          );
        }
      } catch (err) {
        console.error('[disconnect/slack] apps.uninstall failed:', err);
        slackRemoteUninstalled = false;
      }
    }

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

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.disconnected',
      resourceType: 'connector',
      resourceId: provider,
      meta: {
        provider,
        removedSources,
        removedAllowlistRows,
        remainingCredentials: remaining.length,
        slackRemoteUninstalled,
      },
    });

    return NextResponse.json({
      ok: true,
      removedSources,
      removedAllowlistRows,
      remainingCredentials: remaining.length,
      slackRemoteUninstalled,
      drainedJobs: drainedCounts,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
