import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createGithubConnector } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const { auth, env, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in to connect a connector',
        fix: 'Sign in first.',
      });
    }

    if (provider !== 'github') {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: `${provider} connector is not implemented in Foundation`,
        fix: 'Only GitHub is available in v0.0. Other connectors land in subsequent specs.',
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

    const redirectUri = `${env.BETTER_AUTH_URL}/api/connectors/github/callback`;
    const conn = createGithubConnector({
      clientId: env.GITHUB_CONNECTOR_CLIENT_ID,
      clientSecret: env.GITHUB_CONNECTOR_CLIENT_SECRET,
    });
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
