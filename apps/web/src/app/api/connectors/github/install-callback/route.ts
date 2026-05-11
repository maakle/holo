import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  shared,
  githubAppConfigFromEnv,
  mintAppJwt,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';

const PENDING_GRANT_TTL_MS = 2 * 60 * 1000;

interface InstallationResponse {
  id: number;
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
  repository_selection: 'all' | 'selected';
  suspended_at: string | null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const installationIdRaw = url.searchParams.get('installation_id');
    const setupAction = url.searchParams.get('setup_action'); // 'install' | 'update'
    const state = url.searchParams.get('state');

    if (!installationIdRaw || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'GitHub install callback missing installation_id or state',
        fix: 'Restart the install flow from /connections.',
      });
    }
    const installationId = Number.parseInt(installationIdRaw, 10);
    if (!Number.isFinite(installationId)) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Invalid installation_id '${installationIdRaw}'`,
        fix: 'Restart the install flow.',
      });
    }

    const { env, db } = await getServerContext();
    // Two-step bind: the JWT proves the state was issued by us; the real
    // session-bind check (claims.user_id === current session.user.id)
    // happens at /api/connectors/finalize on BETTER_AUTH_URL where the
    // better-auth cookie is readable. Without that downstream check, an
    // attacker could send their JWT-bearing install URL to a victim and
    // land the victim's installation under the attacker's org.
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    // Fetch installation metadata so finalize can persist account_login /
    // type / etc. Uses an App-level JWT — we don't have an installation
    // token yet.
    const config = githubAppConfigFromEnv(env);
    const appJwt = await mintAppJwt(config);
    const ghRes = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!ghRes.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `GET /app/installations/${installationId} returned ${ghRes.status}`,
        fix:
          ghRes.status === 401
            ? 'The App private key does not match GITHUB_APP_ID. Verify both env vars.'
            : 'GitHub may be rate limiting; retry the install flow shortly.',
      });
    }
    const installation = (await ghRes.json()) as InstallationResponse;

    const payload = JSON.stringify({
      provider: 'github',
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      accountId: installation.account.id,
      repositorySelection: installation.repository_selection,
      suspendedAtIso: installation.suspended_at,
      setupAction,
    });

    const inserted = await db
      .insert(schema.oauthPendingGrants)
      .values({
        provider: 'github',
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
    const { env: errEnv } = await getServerContext();
    const u = new URL('/connections/oauth-complete', errEnv.BETTER_AUTH_URL);
    u.searchParams.set('provider', 'github');
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
