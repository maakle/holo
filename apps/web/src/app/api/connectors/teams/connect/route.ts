import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enforceConnectorLimit } from '@/lib/connector-gate';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Enable Teams ingestion for the active org.
 *
 * No per-org credentials are collected — auth lives in env
 * (`TEAMS_BOT_APP_ID` + `TEAMS_BOT_APP_SECRET`) and is shared across orgs.
 * The "connection" is a flip-switch: the row in `connector_credentials`
 * signals "this org wants ingestion runs"; the worker dispatcher reads
 * `teams_installations` at sync time to enumerate which tenants to
 * actually pull from.
 *
 * Pre-flight:
 *   1. Env set? Otherwise the worker can't mint Graph tokens.
 *   2. ≥1 `teams_installations` row for this org? Otherwise there's
 *      nothing to sync — surface a friendly error pointing at the bot
 *      install flow.
 *
 * Idempotent: re-POST is a no-op (row already exists) + an
 * `enqueueInitialSync` to trigger a fresh run.
 */
export async function POST() {
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

    // Plan-limit gate (free → 1 connector). No-op for re-auth and for self-hosted CE.
    await enforceConnectorLimit(db, orgId, 'teams');
    const userId = session.user.id;

    if (!env.TEAMS_BOT_APP_ID || !env.TEAMS_BOT_APP_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem:
          'Teams ingestion is not configured on this deployment — `TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_SECRET` are unset',
        fix: 'Register a multi-tenant Azure AD app + Azure Bot resource, set both env vars on the worker, and redeploy. See docs/connectors/teams-bot.md § Operator setup.',
      });
    }

    // Surface a friendly error if the bot hasn't been installed in any
    // tenant yet — there's literally nothing for Graph to read.
    const installs = await db
      .select({ tenantId: schema.teamsInstallations.tenantId })
      .from(schema.teamsInstallations)
      .where(eq(schema.teamsInstallations.organizationId, orgId))
      .limit(1);
    if (!installs[0]) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem:
          'No Azure AD tenants are linked to this org yet — install the holo bot first via Connect → Microsoft Teams.',
        fix: 'Download holo-bot.zip from /connect, sideload it via Teams Admin Center, add the bot to a team or chat, then paste the tenant ID back. After that, return here to enable ingestion.',
      });
    }
    const tenantId = installs[0].tenantId;

    // connector_credentials row: marks the org as "ingestion enabled".
    // Auth is `none()` so the accessToken is empty; the runner mints
    // Graph tokens per-tenant at sync time.
    const existingCred = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'teams'),
        ),
      )
      .limit(1);
    if (existingCred[0]) {
      // Idempotent path: row already exists; just retrigger sync below.
      await db
        .update(schema.connectorCredentials)
        .set({ status: 'active', lastRefreshedAt: new Date() })
        .where(eq(schema.connectorCredentials.id, existingCred[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'teams',
        accessToken: '',
        status: 'active',
      });
    }

    // One `sources` row per org keyed by the first tenant id — the
    // runner iterates all `teams_installations` rows internally, so a
    // single source row is enough to anchor scheduling + cursor
    // persistence. (If multi-tenant support evolves to per-tenant
    // sources, this becomes one-per-tenant.)
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'teams',
        externalId: tenantId,
        name: 'Microsoft Teams',
        metadata: { teams_singleton: true },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: { updatedAt: new Date() },
      });

    await enqueueInitialSync(db, orgId, 'teams').catch((err) => {
      console.error('teams connect: enqueueInitialSync failed (non-fatal)', err);
    });

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'teams',
      meta: { provider: 'teams', tenantId },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

/* Disconnect is handled by the generic
   `DELETE /api/connectors/[provider]/connection` route, which deletes
   `connector_credentials` + enqueues `disconnect-cleanup` to cascade
   `sources` → `source_artifacts` → `chunks`. The bot's
   `teams_installations` rows live in a different table and are
   untouched — so the @holo bot keeps replying after ingestion is
   disconnected, which is the desired behavior. */
