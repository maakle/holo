import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  shared,
  createSlackSpec,
  createLinearSpec,
  createGoogleDriveSpec,
  createGitlabSpec,
  createGoogleChatSpec,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const { auth, env } = await getServerContext();
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
    const orgId = resolveActiveOrgId(session);

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
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider: 'github',
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
      // No CSRF cookie: the callback runs on WEB_PUBLIC_URL (e.g. ngrok in
      // dev) while the user's session lives on BETTER_AUTH_URL — cookies
      // don't cross. We bind the OAuth handshake to the user via session
      // check on the callback (claims.user_id === session.user.id) instead.
      return NextResponse.json({ authorizeUrl });
    }

    if (provider === 'slack') {
      if (!env.SLACK_CONNECTOR_CLIENT_ID || !env.SLACK_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Slack connector credentials are not configured',
          fix: 'Set SLACK_CONNECTOR_CLIENT_ID and SLACK_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      const redirectUri = `${publicOrigin}/api/connectors/slack/callback`;
      const spec = createSlackSpec({
        clientId: env.SLACK_CONNECTOR_CLIENT_ID,
        clientSecret: env.SLACK_CONNECTOR_CLIENT_SECRET,
      });
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider,
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = spec.auth.buildAuthorizeUrl!({ redirectUri, state });
      return NextResponse.json({ authorizeUrl });
    } else if (provider === 'linear') {
      // First framework-native connector — uses ConnectorSpec from
      // @holo/connector-framework instead of the legacy Connector facade.
      // The spec's auth strategy (oauth2) exposes the same buildAuthorizeUrl
      // shape, so the rest of this route stays generic.
      if (!env.LINEAR_CONNECTOR_CLIENT_ID || !env.LINEAR_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Linear connector credentials are not configured',
          fix: 'Set LINEAR_CONNECTOR_CLIENT_ID and LINEAR_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      const redirectUri = `${publicOrigin}/api/connectors/linear/callback`;
      const spec = createLinearSpec({
        clientId: env.LINEAR_CONNECTOR_CLIENT_ID,
        clientSecret: env.LINEAR_CONNECTOR_CLIENT_SECRET,
      });
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider,
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = spec.auth.buildAuthorizeUrl!({ redirectUri, state });
      return NextResponse.json({ authorizeUrl });
    } else if (provider === 'googledrive') {
      if (
        !env.GOOGLEDRIVE_CONNECTOR_CLIENT_ID ||
        !env.GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET
      ) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Google Drive connector credentials are not configured',
          fix: 'Set GOOGLEDRIVE_CONNECTOR_CLIENT_ID and GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      const redirectUri = `${publicOrigin}/api/connectors/googledrive/callback`;
      const spec = createGoogleDriveSpec({
        clientId: env.GOOGLEDRIVE_CONNECTOR_CLIENT_ID,
        clientSecret: env.GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET,
      });
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider,
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = spec.auth.buildAuthorizeUrl!({ redirectUri, state });
      return NextResponse.json({ authorizeUrl });
    } else if (provider === 'gitlab') {
      // GitLab.com OAuth Application — same shape as Linear, different
      // env vars + spec. Self-hosted GitLab instances are not supported
      // in v1; the spec hard-codes gitlab.com endpoints.
      if (!env.GITLAB_CONNECTOR_CLIENT_ID || !env.GITLAB_CONNECTOR_CLIENT_SECRET) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'GitLab connector credentials are not configured',
          fix: 'Set GITLAB_CONNECTOR_CLIENT_ID and GITLAB_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      const redirectUri = `${publicOrigin}/api/connectors/gitlab/callback`;
      const spec = createGitlabSpec({
        clientId: env.GITLAB_CONNECTOR_CLIENT_ID,
        clientSecret: env.GITLAB_CONNECTOR_CLIENT_SECRET,
      });
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider,
        },
        env.BETTER_AUTH_SECRET,
      );
      const authorizeUrl = spec.auth.buildAuthorizeUrl!({ redirectUri, state });
      return NextResponse.json({ authorizeUrl });
    } else if (provider === 'google-chat') {
      if (
        !env.GOOGLE_CHAT_CONNECTOR_CLIENT_ID ||
        !env.GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET
      ) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'Google Chat connector credentials are not configured',
          fix: 'Set GOOGLE_CHAT_CONNECTOR_CLIENT_ID and GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET in the environment.',
        });
      }
      const redirectUri = `${publicOrigin}/api/connectors/google-chat/callback`;
      const spec = createGoogleChatSpec({
        clientId: env.GOOGLE_CHAT_CONNECTOR_CLIENT_ID,
        clientSecret: env.GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET,
      });
      const csrfNonce = shared.generateCsrfNonce();
      const state = await shared.signState(
        {
          user_id: session.user.id,
          organization_id: orgId,
          csrf_nonce: csrfNonce,
          provider,
        },
        env.BETTER_AUTH_SECRET,
      );
      // Google requires `access_type=offline` + `prompt=consent` to issue a
      // refresh token on every consent (without `prompt=consent`, returning
      // users skip consent and Google omits the refresh token, breaking the
      // 6h sync cycle once the 1h access token expires).
      const base = spec.auth.buildAuthorizeUrl!({ redirectUri, state });
      const authorizeUrl = `${base}&access_type=offline&prompt=consent&include_granted_scopes=true`;
      return NextResponse.json({ authorizeUrl });
    } else {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: `${provider} connector does not use the OAuth initiate flow`,
        fix: 'OAuth-redirect connectors: GitHub, GitLab, Slack, Linear, Google Drive, Google Chat. API-key connectors (Notion, Pylon, HubSpot, Grain) use their own /connect endpoints.',
      });
    }
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
