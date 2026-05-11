import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createGitlabSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { getServerContext } from '@/lib/server-context';

const PENDING_GRANT_TTL_MS = 2 * 60 * 1000;

/**
 * GitLab OAuth callback. Mirrors the slack callback shape: exchange the
 * code on this (WEB_PUBLIC_URL) origin, stash the encrypted tokens in a
 * single-use `oauth_pending_grants` row, then redirect to /finalize on
 * BETTER_AUTH_URL where the better-auth session is checkable. The
 * session-bind check there is the defense against confused-deputy
 * replays of the state JWT.
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
        problem: `GitLab returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'GitLab callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (!env.GITLAB_CONNECTOR_CLIENT_ID || !env.GITLAB_CONNECTOR_CLIENT_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitLab connector credentials are not configured',
        fix: 'Set GITLAB_CONNECTOR_CLIENT_ID and GITLAB_CONNECTOR_CLIENT_SECRET.',
      });
    }

    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/gitlab/callback`;
    const spec = createGitlabSpec({
      clientId: env.GITLAB_CONNECTOR_CLIENT_ID,
      clientSecret: env.GITLAB_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await spec.auth.exchangeCode!({ code, redirectUri });

    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens,
    });
    const ident = await spec.testConnection({ api, tokens });

    const payload = JSON.stringify({
      provider: 'gitlab',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      scope: tokens.scope ?? null,
      // Serialise to ISO string so the JSON round-trip preserves it; the
      // finalize handler converts back to Date when committing.
      expiresAtIso: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
      ident: { externalId: ident.externalId, name: ident.name },
    });

    const inserted = await db
      .insert(schema.oauthPendingGrants)
      .values({
        provider: 'gitlab',
        claimedUserId: claims.user_id,
        claimedOrganizationId: claims.organization_id,
        payload,
        expiresAt: new Date(Date.now() + PENDING_GRANT_TTL_MS),
      })
      .returning({ id: schema.oauthPendingGrants.id });
    const grantId = inserted[0]!.id;

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
    u.searchParams.set('provider', 'gitlab');
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
