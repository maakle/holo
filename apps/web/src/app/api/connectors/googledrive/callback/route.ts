import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createGoogleDriveSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Google Drive OAuth callback. Mirrors the Linear callback shape — the
 * code-for-tokens exchange and identity probe both go through the framework
 * spec's auth + http primitives. Google issues a refresh token only when the
 * authorize URL carries `access_type=offline&prompt=consent`; both are baked
 * into createGoogleDriveSpec.
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
        problem: 'Google Drive callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (
      !env.GOOGLEDRIVE_CONNECTOR_CLIENT_ID ||
      !env.GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET
    ) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Google Drive connector credentials are not configured',
        fix: 'Set GOOGLEDRIVE_CONNECTOR_CLIENT_ID and GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET.',
      });
    }

    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/googledrive/callback`;
    const spec = createGoogleDriveSpec({
      clientId: env.GOOGLEDRIVE_CONNECTOR_CLIENT_ID,
      clientSecret: env.GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await spec.auth.exchangeCode!({ code, redirectUri });

    if (!tokens.refreshToken) {
      // Without a refresh token the integration breaks the moment the access
      // token expires (~1 hour). This usually means the user previously
      // approved the app and Google omitted the refresh token; the spec sets
      // `prompt=consent` to force re-issuance, so this is a misconfig signal
      // rather than expected behaviour.
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Google did not return a refresh token',
        fix: 'Revoke Holo at https://myaccount.google.com/permissions and reconnect.',
      });
    }

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
          eq(schema.connectorCredentials.provider, 'googledrive'),
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
        provider: 'googledrive',
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
        provider: 'googledrive',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { googledrive_singleton: true },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: ident.name,
          metadata: { googledrive_singleton: true },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'googledrive').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'googledrive',
      meta: { provider: 'googledrive', externalId: ident.externalId, name: ident.name },
    });

    const ok = new URL('/connections/oauth-complete', env.BETTER_AUTH_URL);
    ok.searchParams.set('provider', 'googledrive');
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
    u.searchParams.set('provider', 'googledrive');
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
