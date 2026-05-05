import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createSlackConnector } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');
    if (errParam) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Slack returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Slack callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (!env.SLACK_CONNECTOR_CLIENT_ID || !env.SLACK_CONNECTOR_CLIENT_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Slack connector credentials are not configured',
        fix: 'Set SLACK_CONNECTOR_CLIENT_ID and SLACK_CONNECTOR_CLIENT_SECRET in the environment.',
      });
    }

    // Trust the signed state JWT for CSRF protection. We can't bind to a
    // cookie or session here because the callback runs on WEB_PUBLIC_URL
    // (e.g. ngrok in dev) while the user's auth cookie is set on
    // BETTER_AUTH_URL (e.g. localhost) — cookies don't cross origins. The
    // JWT is HS256-signed with BETTER_AUTH_SECRET, has a 10-minute exp,
    // and carries user_id; its signature alone is the CSRF defense. Slack's
    // `code` is single-use, which closes the replay window further.
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/slack/callback`;
    const conn = createSlackConnector({
      clientId: env.SLACK_CONNECTOR_CLIENT_ID,
      clientSecret: env.SLACK_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await conn.exchangeCode({ code, redirectUri });
    const ident = await conn.testConnection(tokens);

    const orgId = claims.organization_id;
    const userId = claims.user_id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'slack'),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          scope: tokens.scope ?? null,
          status: 'active',
          lastRefreshedAt: new Date(),
        })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'slack',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        scope: tokens.scope ?? null,
        status: 'active',
      });
    }

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'slack',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { team_id: ident.externalId },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: { name: ident.name, updatedAt: new Date() },
      });

    await enqueueInitialSync(db, orgId, 'slack').catch(() => {
      // Initial sync is best-effort; if Redis is down or the queue rejects,
      // the recurring scheduler will pick it up at the next tick.
    });

    // OAuth lands in a popup window; the oauth-complete page postMessages
    // the result to the opener tab (which keeps the wizard open) and closes
    // itself. Falls back to a normal /connections redirect if the user got
    // here in a regular tab (e.g. popup blocker triggered same-tab nav).
    const ok = new URL('/connections/oauth-complete', env.BETTER_AUTH_URL);
    ok.searchParams.set('provider', 'slack');
    ok.searchParams.set('status', 'ok');
    return NextResponse.redirect(ok);
  } catch (e) {
    // Resolve the user-facing app origin for redirects. Fall back to req.url
    // if env resolution itself failed (otherwise we'd mask the original error).
    let appOrigin: string;
    try {
      const { env: errEnv } = await getServerContext();
      appOrigin = errEnv.BETTER_AUTH_URL;
    } catch {
      appOrigin = new URL(req.url).origin;
    }
    const u = new URL('/connections/oauth-complete', appOrigin);
    u.searchParams.set('provider', 'slack');
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
