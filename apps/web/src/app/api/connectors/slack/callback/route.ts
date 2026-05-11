import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createSlackSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { getServerContext } from '@/lib/server-context';

const PENDING_GRANT_TTL_MS = 2 * 60 * 1000;

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

    // The signed JWT is the *first* of two checks; the second (and load-bearing
    // one for the confused-deputy threat) happens at /api/connectors/finalize
    // on BETTER_AUTH_URL where the better-auth session cookie is readable.
    // The JWT alone cannot prevent an attacker from sending their state to a
    // victim — it only proves the JWT was issued by us. The session-bind
    // check downstream proves the *current browser* is the one that started
    // the flow.
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/slack/callback`;
    const spec = createSlackSpec({
      clientId: env.SLACK_CONNECTOR_CLIENT_ID,
      clientSecret: env.SLACK_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await spec.auth.exchangeCode!({ code, redirectUri });
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

    const payload = JSON.stringify({
      provider: 'slack',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      scope: tokens.scope ?? null,
      ident: { externalId: ident.externalId, name: ident.name },
    });

    const inserted = await db
      .insert(schema.oauthPendingGrants)
      .values({
        provider: 'slack',
        claimedUserId: claims.user_id,
        claimedOrganizationId: claims.organization_id,
        payload,
        expiresAt: new Date(Date.now() + PENDING_GRANT_TTL_MS),
      })
      .returning({ id: schema.oauthPendingGrants.id });
    const grantId = inserted[0]!.id;

    // Redirect to BETTER_AUTH_URL so the better-auth cookie is readable —
    // this is what makes the session-bind check at /finalize possible. Do
    // NOT redirect to WEB_PUBLIC_URL.
    const finalize = new URL('/api/connectors/finalize', env.BETTER_AUTH_URL);
    finalize.searchParams.set('grant', grantId);
    return NextResponse.redirect(finalize);
  } catch (e) {
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
