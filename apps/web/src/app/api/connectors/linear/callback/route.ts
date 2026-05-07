import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createLinearSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Linear OAuth callback. Mirrors the Grain callback shape but routes the
 * code exchange + testConnection through the framework spec's auth + http
 * primitives instead of the legacy Connector facade.
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
        problem: `Linear returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Linear callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (!env.LINEAR_CONNECTOR_CLIENT_ID || !env.LINEAR_CONNECTOR_CLIENT_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Linear connector credentials are not configured',
        fix: 'Set LINEAR_CONNECTOR_CLIENT_ID and LINEAR_CONNECTOR_CLIENT_SECRET.',
      });
    }

    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/linear/callback`;
    const spec = createLinearSpec({
      clientId: env.LINEAR_CONNECTOR_CLIENT_ID,
      clientSecret: env.LINEAR_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await spec.auth.exchangeCode!({ code, redirectUri });

    // Build a one-shot HTTP client to identify the connecting workspace.
    // The framework's runtime usually constructs this for us; here we're
    // outside a sync, so we wire it manually with the freshly minted token.
    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens,
    });
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
          eq(schema.connectorCredentials.provider, 'linear'),
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
        provider: 'linear',
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
        provider: 'linear',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { linear_singleton: true },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: ident.name,
          metadata: { linear_singleton: true },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'linear').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'linear',
      meta: { provider: 'linear', externalId: ident.externalId, name: ident.name },
    });

    const ok = new URL('/connections/oauth-complete', env.BETTER_AUTH_URL);
    ok.searchParams.set('provider', 'linear');
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
    u.searchParams.set('provider', 'linear');
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
