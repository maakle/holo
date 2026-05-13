import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveSlackAppCreds } from '@/lib/slack-app-config';

export async function GET(req: Request): Promise<Response> {
  const { auth, db, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }

  const orgId = resolveActiveOrgId(session);
  const creds = await resolveSlackAppCreds(db, env, orgId);
  if (!creds) {
    return NextResponse.json(
      {
        error:
          'Slack connector not configured. Either set SLACK_CONNECTOR_CLIENT_ID/SECRET in the environment or register a custom Slack app under Settings → Integrations.',
      },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString('hex');
  (await cookies()).set('slack_personal_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
  const redirectUri = `${publicOrigin}/api/connect/slack-personal/callback`;
  const params = new URLSearchParams({
    client_id: creds.clientId,
    user_scope: 'channels:read,groups:read,im:read,mpim:read',
    redirect_uri: redirectUri,
    state,
  });
  return NextResponse.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`,
  );
}
