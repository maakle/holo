import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createHubspotConnector } from '@holo/connectors';
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
        problem: `HubSpot returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'HubSpot callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    // Env guard BEFORE CSRF check — env-var failure shouldn't consume the nonce.
    if (!env.HUBSPOT_CONNECTOR_CLIENT_ID || !env.HUBSPOT_CONNECTOR_CLIENT_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'HubSpot connector credentials are not configured',
        fix: 'Set HUBSPOT_CONNECTOR_CLIENT_ID and HUBSPOT_CONNECTOR_CLIENT_SECRET.',
      });
    }

    // Trust the signed state JWT alone — see slack/callback/route.ts for
    // the rationale. Cookie/session binding can't survive the WEB_PUBLIC_URL
    // ↔ BETTER_AUTH_URL origin split.
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/hubspot/callback`;
    const conn = createHubspotConnector({
      clientId: env.HUBSPOT_CONNECTOR_CLIENT_ID,
      clientSecret: env.HUBSPOT_CONNECTOR_CLIENT_SECRET,
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
          eq(schema.connectorCredentials.provider, 'hubspot'),
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
        provider: 'hubspot',
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
        provider: 'hubspot',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { hub_id: ident.externalId, hub_domain: ident.name },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: ident.name,
          metadata: { hub_id: ident.externalId, hub_domain: ident.name },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'hubspot').catch(() => {});

    return NextResponse.redirect(new URL('/connections', env.BETTER_AUTH_URL));
  } catch (e) {
    let appOrigin: string;
    try {
      const { env: errEnv } = await getServerContext();
      appOrigin = errEnv.BETTER_AUTH_URL;
    } catch {
      appOrigin = new URL(req.url).origin;
    }
    if (e instanceof HoloError) {
      const u = new URL('/connections', appOrigin);
      u.searchParams.set('connect_error', e.code);
      u.searchParams.set('connect_fix', e.fix);
      return NextResponse.redirect(u);
    }
    console.error(e);
    return NextResponse.redirect(
      new URL('/connections?connect_error=HOLO_INTERNAL', appOrigin),
    );
  }
}
