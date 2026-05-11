import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and, isNull } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Finishes an OAuth/install flow on the BETTER_AUTH_URL origin where the
 * better-auth session cookie is readable. The provider-specific callback
 * (slack, gitlab, github install-callback) runs on WEB_PUBLIC_URL — it
 * exchanges the code, encrypts the resulting tokens + provider payload into
 * an `oauth_pending_grants` row, then redirects the browser here.
 *
 * Security: this is the bind-to-session step. We require an authenticated
 * session whose `user.id` matches the grant's `claimed_user_id`. Without
 * this, a state JWT minted by attacker A could be replayed in victim V's
 * browser to land V's workspace tokens under A's holo org. The grant is
 * marked consumed atomically (UPDATE ... WHERE consumed_at IS NULL) so a
 * single grant can't be used twice even under concurrent navigation.
 */

type SlackPayload = {
  provider: 'slack';
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  ident: { externalId: string; name: string };
};

type GitlabPayload = {
  provider: 'gitlab';
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAtIso: string | null;
  ident: { externalId: string; name: string };
};

type GithubPayload = {
  provider: 'github';
  installationId: number;
  accountLogin: string;
  accountType: string;
  accountId: number;
  repositorySelection: string;
  suspendedAtIso: string | null;
  setupAction: string | null;
};

type GrantPayload = SlackPayload | GitlabPayload | GithubPayload;

export async function GET(req: Request) {
  let provider = 'unknown';
  try {
    const url = new URL(req.url);
    const grantId = url.searchParams.get('grant');
    if (!grantId) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'finalize requires ?grant=<id>',
        fix: 'Restart the connect flow.',
      });
    }

    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in to finish connecting',
        fix: 'Sign in and restart the connect flow.',
      });
    }

    const rows = await db
      .select()
      .from(schema.oauthPendingGrants)
      .where(eq(schema.oauthPendingGrants.id, grantId))
      .limit(1);
    const grant = rows[0];
    if (!grant) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'grant not found',
        fix: 'Restart the connect flow.',
      });
    }
    provider = grant.provider;

    if (grant.consumedAt) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'grant already used',
        fix: 'Restart the connect flow.',
      });
    }
    if (grant.expiresAt.getTime() < Date.now()) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'grant expired',
        fix: 'Restart the connect flow — finalize must complete within 2 minutes.',
      });
    }

    // The defense. The state JWT can be exfiltrated by an attacker who
    // initiates the flow themselves and sends the resulting authorize URL
    // to a victim. Without this check, the victim's workspace tokens would
    // land under the attacker's claimed (user, org). Requiring the
    // currently-signed-in user.id to match the JWT claim makes the only
    // browser that can finish the flow the one that started it.
    if (session.user.id !== grant.claimedUserId) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'session does not match the user that initiated this connect flow',
        fix: 'Sign in as the user who started the connection, or restart from your account.',
      });
    }

    // Atomic single-use. If two browser tabs race the same grant id, only
    // one UPDATE returns a row; the other falls through to the "already
    // used" branch on a retry. We re-check the user_id in the WHERE clause
    // belt-and-braces in case the row's grant changed between SELECT and
    // UPDATE (it can't — grants are immutable until consumed — but it
    // costs nothing).
    const consumed = await db
      .update(schema.oauthPendingGrants)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.oauthPendingGrants.id, grantId),
          eq(schema.oauthPendingGrants.claimedUserId, session.user.id),
          isNull(schema.oauthPendingGrants.consumedAt),
        ),
      )
      .returning({ id: schema.oauthPendingGrants.id });
    if (consumed.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'grant already consumed by a parallel request',
        fix: 'Restart the connect flow.',
      });
    }

    const orgId = grant.claimedOrganizationId;
    const userId = grant.claimedUserId;
    const payload = JSON.parse(grant.payload) as GrantPayload;

    if (payload.provider === 'slack') {
      await commitOAuthCredential(db, {
        orgId,
        userId,
        provider: 'slack',
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        scope: payload.scope,
        expiresAt: null,
      });
      await upsertSource(db, {
        orgId,
        provider: 'slack',
        externalId: payload.ident.externalId,
        name: payload.ident.name,
        metadata: { team_id: payload.ident.externalId },
      });
      await enqueueInitialSync(db, orgId, 'slack').catch(() => {});
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId,
        eventType: 'connector.connected',
        resourceType: 'connector',
        resourceId: 'slack',
        meta: {
          provider: 'slack',
          externalId: payload.ident.externalId,
          name: payload.ident.name,
        },
      });
    } else if (payload.provider === 'gitlab') {
      await commitOAuthCredential(db, {
        orgId,
        userId,
        provider: 'gitlab',
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        scope: payload.scope,
        // GitLab.com access tokens live 2h. Without expiresAt the framework's
        // shouldRefresh() returns false and the token is never rotated, so
        // sync starts 401-ing the moment the first window closes.
        expiresAt: payload.expiresAtIso ? new Date(payload.expiresAtIso) : null,
      });
      await upsertSource(db, {
        orgId,
        provider: 'gitlab',
        externalId: payload.ident.externalId,
        name: payload.ident.name,
        metadata: { gitlab_singleton: true },
      });
      await enqueueInitialSync(db, orgId, 'gitlab').catch(() => {});
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId,
        eventType: 'connector.connected',
        resourceType: 'connector',
        resourceId: 'gitlab',
        meta: {
          provider: 'gitlab',
          externalId: payload.ident.externalId,
          name: payload.ident.name,
        },
      });
    } else if (payload.provider === 'github') {
      await db
        .insert(schema.githubInstallations)
        .values({
          organizationId: orgId,
          installationId: payload.installationId,
          accountLogin: payload.accountLogin,
          accountType: payload.accountType,
          accountId: payload.accountId,
          repositorySelection: payload.repositorySelection,
          installedByUserId: userId,
          suspendedAt: payload.suspendedAtIso ? new Date(payload.suspendedAtIso) : null,
        })
        .onConflictDoUpdate({
          target: [
            schema.githubInstallations.organizationId,
            schema.githubInstallations.installationId,
          ],
          set: {
            accountLogin: payload.accountLogin,
            accountType: payload.accountType,
            accountId: payload.accountId,
            repositorySelection: payload.repositorySelection,
            suspendedAt: payload.suspendedAtIso ? new Date(payload.suspendedAtIso) : null,
          },
        });
      await upsertSource(db, {
        orgId,
        provider: 'github',
        externalId: String(payload.installationId),
        name: payload.accountLogin,
        metadata: {
          installation_id: payload.installationId,
          account_login: payload.accountLogin,
          account_type: payload.accountType,
        },
      });
      // Mirror prior behaviour: only enqueue a sync on first install, not
      // on the "update repo selection" round-trip.
      if (payload.setupAction !== 'update') {
        await enqueueInitialSync(db, orgId, 'github').catch(() => {});
      }
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId,
        eventType: 'connector.connected',
        resourceType: 'connector',
        resourceId: 'github',
        meta: {
          provider: 'github',
          installationId: payload.installationId,
          accountLogin: payload.accountLogin,
          accountType: payload.accountType,
          setupAction: payload.setupAction,
        },
      });
    }

    const ok = new URL('/connections/oauth-complete', req.url);
    ok.searchParams.set('provider', provider);
    ok.searchParams.set('status', 'ok');
    return NextResponse.redirect(ok);
  } catch (e) {
    const u = new URL('/connections/oauth-complete', req.url);
    u.searchParams.set('provider', provider);
    u.searchParams.set('status', 'error');
    if (e instanceof HoloError) {
      u.searchParams.set('code', e.code);
      u.searchParams.set('fix', e.fix);
    } else {
      console.error(e);
      u.searchParams.set('code', 'HOLO_INTERNAL');
    }
    return NextResponse.redirect(u);
  }
}

async function commitOAuthCredential(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  opts: {
    orgId: string;
    userId: string;
    provider: 'slack' | 'gitlab';
    accessToken: string;
    refreshToken: string | null;
    scope: string | null;
    expiresAt: Date | null;
  },
) {
  const existing = await db
    .select({ id: schema.connectorCredentials.id })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, opts.orgId),
        eq(schema.connectorCredentials.userId, opts.userId),
        eq(schema.connectorCredentials.provider, opts.provider),
      ),
    );
  if (existing[0]) {
    await db
      .update(schema.connectorCredentials)
      .set({
        accessToken: opts.accessToken,
        refreshToken: opts.refreshToken,
        scope: opts.scope,
        expiresAt: opts.expiresAt,
        status: 'active',
        lastRefreshedAt: new Date(),
      })
      .where(eq(schema.connectorCredentials.id, existing[0].id));
  } else {
    await db.insert(schema.connectorCredentials).values({
      organizationId: opts.orgId,
      userId: opts.userId,
      provider: opts.provider,
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      scope: opts.scope,
      expiresAt: opts.expiresAt,
      status: 'active',
    });
  }
}

async function upsertSource(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  opts: {
    orgId: string;
    provider: 'slack' | 'gitlab' | 'github';
    externalId: string;
    name: string;
    metadata: Record<string, unknown>;
  },
) {
  await db
    .insert(schema.sources)
    .values({
      organizationId: opts.orgId,
      provider: opts.provider,
      externalId: opts.externalId,
      name: opts.name,
      metadata: opts.metadata,
    })
    .onConflictDoUpdate({
      target: [schema.sources.organizationId, schema.sources.provider, schema.sources.externalId],
      set: { name: opts.name, metadata: opts.metadata, updatedAt: new Date() },
    });
}
