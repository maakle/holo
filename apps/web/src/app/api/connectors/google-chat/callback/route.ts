import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createGoogleChatSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Google Chat OAuth callback. Mirrors the Slack/Linear callback shape: verify
 * the signed state, exchange the code for tokens via the framework spec's
 * oauth2 strategy, identify the workspace via Google's userinfo endpoint
 * (Chat doesn't have a /me), then upsert the credential + source.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');
    if (errParam) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Google returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Google Chat callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (
      !env.GOOGLE_CHAT_CONNECTOR_CLIENT_ID ||
      !env.GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET
    ) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Google Chat connector credentials are not configured',
        fix: 'Set GOOGLE_CHAT_CONNECTOR_CLIENT_ID and GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET.',
      });
    }

    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/google-chat/callback`;
    const spec = createGoogleChatSpec({
      clientId: env.GOOGLE_CHAT_CONNECTOR_CLIENT_ID,
      clientSecret: env.GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await spec.auth.exchangeCode!({ code, redirectUri });
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

    const orgId = claims.organization_id;
    const userId = claims.user_id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'google-chat'),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          scope: tokens.scope ?? null,
          expiresAt: tokens.expiresAt ?? null,
          status: 'active',
          lastRefreshedAt: new Date(),
        })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'google-chat',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        scope: tokens.scope ?? null,
        expiresAt: tokens.expiresAt ?? null,
        status: 'active',
      });
    }

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'google-chat',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { google_workspace_domain: ident.externalId },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: { name: ident.name, updatedAt: new Date() },
      });

    await enqueueInitialSync(db, orgId, 'google-chat').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'google-chat',
      meta: { provider: 'google-chat', externalId: ident.externalId, name: ident.name },
    });

    const ok = new URL('/connections/oauth-complete', env.BETTER_AUTH_URL);
    ok.searchParams.set('provider', 'google-chat');
    ok.searchParams.set('status', 'ok');
    return NextResponse.redirect(ok);
  } catch (e) {
    let appOrigin: string;
    try {
      const { env: errEnv } = await getServerContext();
      appOrigin = errEnv.BETTER_AUTH_URL;
    } catch {
      appOrigin = new URL(req.url).origin;
    }
    const u = new URL('/connections/oauth-complete', appOrigin);
    u.searchParams.set('provider', 'google-chat');
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
