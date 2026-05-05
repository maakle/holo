import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  shared,
  createSlackConnector,
  createGrainConnector,
  createHubspotConnector,
  type Connector,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const { auth, env, defaultOrgId } = await getServerContext();
    const hdrs = await headers();
    // OAuth redirect_uri must be a publicly reachable URL the IdP can hit.
    // In dev with a tunnel, set WEB_PUBLIC_URL to the tunnel; BETTER_AUTH_URL
    // can stay localhost for browser-side auth/cookies.
    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in to connect a connector',
        fix: 'Sign in first.',
      });
    }

    // GitHub uses a GitHub App install flow rather than OAuth — the redirect
    // target is github.com/apps/<slug>/installations/new and the state cookie
    // is verified by the install-callback route. No client_id/secret needed.
    if (provider === 'github') {
      if (!env.GITHUB_APP_SLUG) {
        throw holoError({
          code: ErrorCode.HOLO_ENV_INVALID,
          problem: 'GITHUB_APP_SLUG is not set',
          fix: 'Register a GitHub App and set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY_B64. See docs/connectors/github-app.md.',
        });
      }
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: defaultOrgId,
          csrf_nonce: csrfNonce,
          provider: 'github',
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;

      const cookieStore = await cookies();
      cookieStore.set(shared.CSRF_COOKIE_NAME, csrfNonce, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
        secure: env.NODE_ENV === 'production',
      });

      return NextResponse.json({ authorizeUrl });
    }

    let conn: Connector;
    let redirectUri: string;

    if (provider === 'slack') {
      if (!env.SLACK_CONNECTOR_CLIENT_ID || !env.SLACK_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Slack connector credentials are not configured',
          fix: 'Set SLACK_CONNECTOR_CLIENT_ID and SLACK_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      redirectUri = `${publicOrigin}/api/connectors/slack/callback`;
      conn = createSlackConnector({
        clientId: env.SLACK_CONNECTOR_CLIENT_ID,
        clientSecret: env.SLACK_CONNECTOR_CLIENT_SECRET,
      });
    } else if (provider === 'grain') {
      if (!env.GRAIN_CONNECTOR_CLIENT_ID || !env.GRAIN_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Grain connector credentials are not configured',
          fix: 'Set GRAIN_CONNECTOR_CLIENT_ID and GRAIN_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      redirectUri = `${publicOrigin}/api/connectors/grain/callback`;
      conn = createGrainConnector({
        clientId: env.GRAIN_CONNECTOR_CLIENT_ID,
        clientSecret: env.GRAIN_CONNECTOR_CLIENT_SECRET,
      });
    } else if (provider === 'hubspot') {
      if (!env.HUBSPOT_CONNECTOR_CLIENT_ID || !env.HUBSPOT_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'HubSpot connector credentials are not configured',
          fix: 'Set HUBSPOT_CONNECTOR_CLIENT_ID and HUBSPOT_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      redirectUri = `${publicOrigin}/api/connectors/hubspot/callback`;
      conn = createHubspotConnector({
        clientId: env.HUBSPOT_CONNECTOR_CLIENT_ID,
        clientSecret: env.HUBSPOT_CONNECTOR_CLIENT_SECRET,
      });
    } else {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: `${provider} connector is not implemented`,
        fix: 'OAuth-redirect connectors: GitHub, Slack, Grain, HubSpot. API-key connectors (Notion, Pylon) use their own /connect endpoints.',
      });
    }

    const csrfNonce = shared.generateCsrfNonce();
    const state = await shared.signState(
      {
        user_id: session.user.id,
        organization_id: defaultOrgId,
        csrf_nonce: csrfNonce,
        provider,
      },
      env.BETTER_AUTH_SECRET,
    );

    const authorizeUrl = conn.buildAuthorizeUrl({ redirectUri, state });

    const cookieStore = await cookies();
    cookieStore.set(shared.CSRF_COOKIE_NAME, csrfNonce, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
      secure: env.NODE_ENV === 'production',
    });

    return NextResponse.json({ authorizeUrl });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_CONNECTOR_NOT_IMPLEMENTED'
            ? 501
            : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
      { status: 500 },
    );
  }
}
