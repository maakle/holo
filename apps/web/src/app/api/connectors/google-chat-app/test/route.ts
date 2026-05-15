import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

/**
 * Proxies the gateway's `GET /google-chat-app/healthz` so the dashboard
 * can show "Verify deployment" results without dealing with CORS. The
 * dashboard sees gateway-truth (env vars on the gateway, not the web app)
 * because the gateway is the host that actually verifies inbound JWTs.
 *
 * Session-gated, but unscoped to org — this is operator-facing data about
 * a shared deployment. Any signed-in user can see whether the deployment
 * is healthy. (No secrets are returned, only client_email which is also
 * visible in the Cloud Console.)
 */
export async function GET() {
  try {
    const { auth, env } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }

    const gatewayBase = env.MCP_PUBLIC_URL?.replace(/\/+$/, '');
    if (!gatewayBase) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'MCP_PUBLIC_URL is not set on the web app',
        fix: 'Set MCP_PUBLIC_URL to the gateway base URL and redeploy.',
      });
    }

    const target = `${gatewayBase}/google-chat-app/healthz`;
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: 'GET',
        // No cache: the operator clicks this button to see the live truth.
        cache: 'no-store',
      });
    } catch (cause) {
      return NextResponse.json(
        {
          problem: `gateway unreachable at ${target}`,
          fix: 'Check the gateway is running and MCP_PUBLIC_URL is correct.',
          cause: String(cause),
        },
        { status: 502 },
      );
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          problem: `gateway returned ${upstream.status}`,
          fix: 'Check gateway logs for the underlying error.',
        },
        { status: 502 },
      );
    }

    const report = await upstream.json();
    return NextResponse.json({ gateway: gatewayBase, report });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
