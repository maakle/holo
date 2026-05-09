import 'server-only';
import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ErrorCode, HoloError, holoError } from '@holo/errors';
import { getServerContext } from './server-context';
import { resolveActiveOrgId } from './active-org';

/**
 * Wrap a Next.js route handler so org-scoping is structural, not a convention
 * each route has to remember. The handler receives a fully-resolved
 * `{ ctx, session, orgId, params }` — there's no path that produces a
 * handler with `orgId === undefined`.
 *
 * Why a wrapper, not a hook: ESM modules can't enforce ordering, but a
 * wrapper means the route file literally cannot export a GET/POST that
 * skips auth + active-org resolution. The earlier per-route copy-pasted
 * pattern (`const session = await ...; if (!session) throw ...; const
 * orgId = resolveActiveOrgId(session)`) was 12 lines of boilerplate per
 * file and one missed line away from a wrong-tenant data leak.
 *
 * Errors:
 *  - No session  → HoloError(HOLO_AUTH_NO_SESSION) → 401
 *  - No active org → HoloError(HOLO_AUTH_NO_ACTIVE_ORG) → 401
 *  - Anything thrown by the handler → HoloError → status from `errorCodeToStatus`,
 *    unknown → 500
 */

type Session = NonNullable<
  Awaited<
    ReturnType<
      Awaited<ReturnType<typeof getServerContext>>['auth']['api']['getSession']
    >
  >
>;

type Ctx = Awaited<ReturnType<typeof getServerContext>>;

interface ActiveOrgArgs<Params> {
  req: NextRequest;
  ctx: Ctx;
  session: Session;
  orgId: string;
  params: Params;
}

type RouteHandlerResult = Response | Record<string, unknown> | null | undefined;

type RouteHandler<Params> = (args: ActiveOrgArgs<Params>) => Promise<RouteHandlerResult>;

export interface NextRouteContext<Params> {
  params: Promise<Params>;
}

export function withActiveOrg<Params = Record<string, never>>(
  handler: RouteHandler<Params>,
): (req: NextRequest, route?: NextRouteContext<Params>) => Promise<Response> {
  return async (req, route) => {
    try {
      const ctx = await getServerContext();
      const session = await ctx.auth.api.getSession({ headers: await headers() });
      if (!session) {
        throw holoError({
          code: ErrorCode.HOLO_AUTH_NO_SESSION,
          problem: 'must be signed in',
          fix: 'Sign in first.',
        });
      }
      const orgId = resolveActiveOrgId(session);
      const params = (route ? await route.params : ({} as Params));
      const result = await handler({ req, ctx, session, orgId, params });
      if (result instanceof Response) return result;
      if (result === undefined || result === null) {
        return new NextResponse(null, { status: 204 });
      }
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof HoloError) {
        return NextResponse.json(
          { problem: e.problem, fix: e.fix, code: e.code },
          { status: errorCodeToStatus(e.code) },
        );
      }
      console.error('withActiveOrg: unhandled error', e);
      return NextResponse.json({ problem: 'internal error' }, { status: 500 });
    }
  };
}

function errorCodeToStatus(code: HoloError['code']): number {
  switch (code) {
    case ErrorCode.HOLO_AUTH_NO_SESSION:
    case ErrorCode.HOLO_AUTH_NO_ACTIVE_ORG:
      return 401;
    case ErrorCode.HOLO_AUTH_FORBIDDEN:
      return 403;
    case ErrorCode.HOLO_NOT_FOUND:
    case ErrorCode.HOLO_ARTIFACT_NOT_FOUND:
    case ErrorCode.HOLO_GITHUB_REPO_NOT_FOUND:
    case ErrorCode.HOLO_NOTION_PAGE_NOT_FOUND:
      return 404;
    case ErrorCode.HOLO_INGESTION_RATE_LIMITED:
      return 429;
    default:
      // HOLO_INVALID_INPUT, HOLO_OAUTH_*, token-invalid variants, etc. — all 400.
      return 400;
  }
}
