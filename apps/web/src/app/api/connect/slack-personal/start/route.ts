import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { getServerContext } from '@/lib/server-context';

export async function GET(req: Request): Promise<Response> {
  const { auth, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }

  if (!env.SLACK_CONNECTOR_CLIENT_ID || !env.SLACK_CONNECTOR_CLIENT_SECRET) {
    return NextResponse.json(
      {
        error:
          'Slack connector not configured (missing SLACK_CONNECTOR_CLIENT_ID/SECRET)',
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

  const redirectUri = new URL(
    '/api/connect/slack-personal/callback',
    req.url,
  ).toString();
  const params = new URLSearchParams({
    client_id: env.SLACK_CONNECTOR_CLIENT_ID,
    user_scope: 'channels:read,groups:read,im:read,mpim:read',
    redirect_uri: redirectUri,
    state,
  });
  return NextResponse.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`,
  );
}
