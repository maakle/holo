import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveSlackAppCreds } from '@/lib/slack-app-config';
import { createSlackUserApiClient } from '@holo/connectors';
import { runSlackSubjectsSync } from '@holo/user-subjects';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');
    if (errParam) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Slack returned error: ${errParam}`,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Slack callback missing code or state',
        fix: 'Restart the connect flow from /connect/slack-personal.',
      });
    }
    const cookieJar = await cookies();
    const expectedState = cookieJar.get('slack_personal_state')?.value;
    if (!expectedState || state !== expectedState) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Slack callback state mismatch',
        fix: 'Restart the connect flow.',
      });
    }
    cookieJar.delete('slack_personal_state');

    const { auth, db, env } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.redirect(new URL('/sign-in', req.url));
    }

    const sessionUser = session.user as { id: string; organizationId?: string };
    let organizationId = sessionUser.organizationId;
    if (!organizationId) {
      const rows = await db
        .select({ organizationId: schema.user.organizationId })
        .from(schema.user)
        .where(eq(schema.user.id, sessionUser.id))
        .limit(1);
      if (!rows[0]) {
        throw holoError({
          code: ErrorCode.HOLO_INTERNAL,
          problem: 'Logged-in user has no organizationId',
          fix: 'Re-run the user creation seed.',
        });
      }
      organizationId = rows[0].organizationId;
    }

    // Use the same app credentials the user authorized against in /start.
    // The org's custom app (EE) takes precedence over the shared env app.
    const creds = await resolveSlackAppCreds(db, env, organizationId);
    if (!creds) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Slack connector credentials are not configured',
        fix: 'Set SLACK_CONNECTOR_CLIENT_ID and SLACK_CONNECTOR_CLIENT_SECRET, or register a custom Slack app under Settings → Integrations.',
      });
    }

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connect/slack-personal/callback`;
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const tokenJson = (await tokenRes.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: { id?: string; access_token?: string; scope?: string };
    };
    if (
      !tokenJson.ok ||
      !tokenJson.authed_user?.access_token ||
      !tokenJson.authed_user?.id
    ) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Slack user-token exchange failed: ${tokenJson.error ?? 'no authed_user'}`,
        fix: 'Restart the connect flow. Verify the Slack app has user_scope configured.',
      });
    }
    const userToken = tokenJson.authed_user.access_token;
    const slackUserId = tokenJson.authed_user.id;
    const scopes = (tokenJson.authed_user.scope ?? '').split(',').filter(Boolean);

    await db
      .insert(schema.slackUserCredentials)
      .values({
        userId: sessionUser.id,
        organizationId,
        slackUserId,
        accessTokenEncrypted: userToken,
        scopes,
      })
      .onConflictDoUpdate({
        target: schema.slackUserCredentials.userId,
        set: {
          slackUserId,
          accessTokenEncrypted: userToken,
          scopes,
          connectedAt: new Date(),
        },
      });

    // Inline-run subjects sync so the user's channel subjects are populated
    // immediately (otherwise they wait up to 30 min for the cron). Failure is
    // non-fatal — the cron will retry.
    try {
      const client = createSlackUserApiClient(userToken);
      await runSlackSubjectsSync({
        db,
        userId: sessionUser.id,
        organizationId,
        client,
      });
    } catch (err) {
      console.error(
        'Inline Slack subjects sync failed (will retry via cron):',
        err,
      );
    }

    return NextResponse.redirect(
      new URL('/connect/slack-personal?success=1', req.url),
    );
  } catch (err) {
    if (err instanceof HoloError) {
      return NextResponse.json(err.toJSON(), { status: 400 });
    }
    throw err;
  }
}
