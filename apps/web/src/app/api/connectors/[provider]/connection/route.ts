import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  githubAppConfigFromEnv,
  uninstallApp,
  isGoogleServiceAccountProvider,
} from '@holo/connectors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveSlackAppCreds } from '@/lib/slack-app-config';
import {
  drainJobsForOrg,
  enqueueDisconnectCleanup,
  isSyncProvider,
  SYNC_PROVIDERS_FIX_HINT,
  type Provider,
} from '@/lib/sync-queue';

/**
 * Disconnect a connector for the active org.
 *
 * The handler is split into two phases:
 *
 * 1. **Synchronous, bounded fast bits** (run inline so we can fail the request
 *    on auth/remote-API errors before we tell the user "ok, cleaning up"):
 *    - Capture the Slack token before we revoke it (we may need it for the
 *      apps.uninstall call below).
 *    - Run the provider's remote uninstall (GitHub App, Slack apps.uninstall).
 *    - Drop the credential / installation / service-account rows so a
 *      subsequent reconnect attempt can't re-use this user's stale token,
 *      and so the dashboard's `connected` derivation flips to false.
 *    - Drain queued/delayed sync jobs for this org so the worker doesn't
 *      pick one up after the credential is gone.
 *
 * 2. **Async cleanup** — enqueued, returned to the user as `disconnecting:true`:
 *    - Delete `sources` for (org, provider) — cascades through
 *      `source_artifacts` → `chunks`. This is the slow part for big
 *      workspaces (millions of chunks), so blocking the request thread on
 *      it leaves the user staring at "Disconnecting…" for a minute or
 *      more. Instead the dashboard reads `connector_disconnect_jobs`
 *      where `finished_at IS NULL` to render the in-flight state and to
 *      block reconnects until the cleanup actually completes.
 *    - Delete `connector_allowlists` for the same scope (folded in here so
 *      the next reconnect starts from a clean slate).
 */
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

    const { auth, db, env } = await getServerContext();
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

    // Per-branch metadata reported back to the caller and folded into the
    // audit event. Concrete fields vary by provider; values are filled in
    // below.
    const auditMeta: Record<string, unknown> = { provider };

    if (provider === 'github') {
      // GitHub uses an org-level App installation. Disconnect order matters:
      //   1. Read installation_id locally (we lose it once we delete the row).
      //   2. Tell GitHub to uninstall the App so it disappears from the
      //      admin's github.com/settings/installations page.
      //   3. Delete the local installation row regardless of whether the
      //      GitHub-side uninstall actually changed anything — a 404 from
      //      GitHub is treated as success (already gone).
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
      auditMeta.remoteUninstalled = remoteUninstalled;
      auditMeta.remoteAlreadyGone = remoteAlreadyGone;
      auditMeta.removedInstallations = deletedInstalls.length;
    } else if (isGoogleServiceAccountProvider(provider)) {
      // Google service-account connectors store credentials in
      // `connector_service_accounts` (one row per org+provider, no userId).
      // Disconnect is a full tear-down: delete the SA row sync. No remote
      // uninstall — the SA itself lives in the customer's Google Cloud
      // project; we only revoke our access by dropping the key locally.
      const deletedSa = await db
        .delete(schema.connectorServiceAccounts)
        .where(
          and(
            eq(schema.connectorServiceAccounts.organizationId, orgId),
            eq(schema.connectorServiceAccounts.provider, provider),
          ),
        )
        .returning({ id: schema.connectorServiceAccounts.id });
      auditMeta.removedServiceAccounts = deletedSa.length;
    } else {
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

      // If no active credentials remain for this org+provider this is the
      // "last user disconnects" path. For Slack we additionally fully
      // uninstall the app from the workspace via apps.uninstall — that
      // revokes the token, removes the holo bot from every channel it
      // joined, and removes the app from the workspace's installed-apps
      // list. Best-effort: a failure here doesn't block local cleanup.
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

      let slackRemoteUninstalled: boolean | null = null;
      if (provider === 'slack' && remaining.length === 0 && tokenToUninstall) {
        // apps.uninstall must use the credentials of whichever Slack app
        // issued the token — using the env client_id against a custom-app
        // token returns `invalid_client_id`.
        const creds = await resolveSlackAppCreds(db, env, orgId);
        if (creds) {
          try {
            const params = new URLSearchParams({
              client_id: creds.clientId,
              client_secret: creds.clientSecret,
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
      }

      auditMeta.remainingCredentials = remaining.length;
      auditMeta.lastUser = remaining.length === 0;
      if (provider === 'slack') {
        auditMeta.slackRemoteUninstalled = slackRemoteUninstalled;
      }

      // Source / allowlist deletion is deferred to the worker only when this
      // was the last active user for this org — otherwise sources are still
      // in use by other users' credentials and must stay put. We signal that
      // to the worker by simply not enqueueing.
      if (remaining.length > 0) {
        emitAuditEvent({
          db,
          organizationId: orgId,
          userId,
          eventType: 'connector.disconnected',
          resourceType: 'connector',
          resourceId: provider,
          meta: auditMeta,
        });
        return NextResponse.json({
          ok: true,
          disconnecting: false,
          ...auditMeta,
        });
      }
    }

    // Drain any waiting/delayed sync jobs for this org BEFORE we tell the
    // worker we're cleaning up. Otherwise a sync job could re-create artifacts
    // mid-cleanup. Best-effort: a Redis blip shouldn't block disconnect.
    let drainedCounts: Record<string, number> | null = null;
    try {
      const { removed } = await drainJobsForOrg(provider, orgId);
      drainedCounts = removed;
    } catch (err) {
      console.error(`[disconnect/${provider}] drainJobsForOrg failed:`, err);
    }
    auditMeta.drainedJobs = drainedCounts;

    // Insert (or pick up) the disconnect-cleanup job row. The partial unique
    // index on (organizationId, provider) WHERE finished_at IS NULL means a
    // second Disconnect click while a cleanup is already in flight no-ops on
    // the existing row instead of spawning a duplicate.
    const jobRowId = await upsertDisconnectJob(db, orgId, provider);

    await enqueueDisconnectCleanup({
      jobRowId,
      organizationId: orgId,
      provider,
    });

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.disconnected',
      resourceType: 'connector',
      resourceId: provider,
      meta: { ...auditMeta, disconnectJobId: jobRowId },
    });

    // 202 Accepted: we've kicked off cleanup, the dashboard should poll the
    // status endpoint to find out when it actually finishes.
    return NextResponse.json(
      {
        ok: true,
        disconnecting: true,
        disconnectJobId: jobRowId,
        ...auditMeta,
      },
      { status: 202 },
    );
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

/**
 * Insert a `connector_disconnect_jobs` row, or pick up the open one already
 * present for this (org, provider). Returns the row id either way so the
 * worker can mark it finished when it's done.
 */
async function upsertDisconnectJob(
  db: DB,
  organizationId: string,
  provider: Provider,
): Promise<string> {
  const inserted = await db
    .insert(schema.connectorDisconnectJobs)
    .values({ organizationId, provider })
    .onConflictDoNothing({
      target: [
        schema.connectorDisconnectJobs.organizationId,
        schema.connectorDisconnectJobs.provider,
      ],
      where: isNull(schema.connectorDisconnectJobs.finishedAt),
    })
    .returning({ id: schema.connectorDisconnectJobs.id });
  const insertedRow = inserted[0];
  if (insertedRow) return insertedRow.id;

  const existing = await db
    .select({ id: schema.connectorDisconnectJobs.id })
    .from(schema.connectorDisconnectJobs)
    .where(
      and(
        eq(schema.connectorDisconnectJobs.organizationId, organizationId),
        eq(schema.connectorDisconnectJobs.provider, provider),
        isNull(schema.connectorDisconnectJobs.finishedAt),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) {
    // Race: the partial unique blocked our insert but the existing row got
    // marked finished between then and our SELECT. Insert again — this time
    // there's no conflicting row.
    const reinserted = await db
      .insert(schema.connectorDisconnectJobs)
      .values({ organizationId, provider })
      .returning({ id: schema.connectorDisconnectJobs.id });
    const reinsertedRow = reinserted[0];
    if (!reinsertedRow) {
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: 'disconnect-cleanup insert returned no rows',
        fix: 'Retry the disconnect; this is almost always a transient DB hiccup.',
      });
    }
    return reinsertedRow.id;
  }
  return existingRow.id;
}
