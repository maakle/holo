import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { enqueueResync } from '@/lib/sync-queue';

type GithubRepo = {
  id: number;
  full_name: string;
  private: boolean;
  description: string | null;
  fork: boolean;
  archived: boolean;
  pushed_at: string | null;
};

async function loadAccessToken(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  organizationId: string,
  userId: string,
): Promise<string> {
  const rows = await db
    .select({ accessToken: schema.connectorCredentials.accessToken })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, organizationId),
        eq(schema.connectorCredentials.userId, userId),
        eq(schema.connectorCredentials.provider, 'github'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    )
    .orderBy(desc(schema.connectorCredentials.connectedAt))
    .limit(1);
  const token = rows[0]?.accessToken;
  if (!token) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'GitHub is not connected for this user',
      fix: 'Click Connect on the GitHub row before picking repos.',
    });
  }
  return token;
}

async function listAllRepos(token: string): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  let page = 1;
  // Cap pagination so a user with many orgs can't make the page hang.
  while (page <= 5) {
    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'pushed');
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `GitHub /user/repos returned ${res.status}`,
        fix: 'Reconnect GitHub or verify the OAuth scope includes `repo read:org`.',
      });
    }
    const items = (await res.json()) as GithubRepo[];
    out.push(...items);
    if (items.length < 100) break;
    page += 1;
  }
  return out;
}

export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId =
      (session.user as unknown as { organizationId?: string }).organizationId ?? defaultOrgId;
    const userId = session.user.id;

    const token = await loadAccessToken(db, orgId, userId);
    const repos = await listAllRepos(token);

    const allowlist = await db
      .select({
        pattern: schema.connectorAllowlists.pattern,
        patternKind: schema.connectorAllowlists.patternKind,
        decision: schema.connectorAllowlists.decision,
      })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'github'),
        ),
      );

    const includedExact = new Set(
      allowlist
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => r.pattern),
    );

    return NextResponse.json({
      repos: repos
        .filter((r) => !r.archived)
        .map((r) => ({
          fullName: r.full_name,
          private: r.private,
          description: r.description,
          fork: r.fork,
          pushedAt: r.pushed_at,
          selected: includedExact.has(r.full_name),
        })),
      allowlist: allowlist.map((r) => ({
        pattern: r.pattern,
        kind: r.patternKind,
        decision: r.decision,
      })),
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId =
      (session.user as unknown as { organizationId?: string }).organizationId ?? defaultOrgId;
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as { repos?: string[] };
    const desired = Array.isArray(body.repos) ? Array.from(new Set(body.repos)) : [];
    if (desired.length > 50) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${desired.length} repos (max 50)`,
        fix: 'Select 50 or fewer repos.',
      });
    }
    for (const r of desired) {
      if (typeof r !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(r)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Invalid repo identifier '${r}'`,
          fix: 'Repos must be in `owner/name` form.',
        });
      }
    }

    const existing = await db
      .select({
        id: schema.connectorAllowlists.id,
        pattern: schema.connectorAllowlists.pattern,
        patternKind: schema.connectorAllowlists.patternKind,
        decision: schema.connectorAllowlists.decision,
      })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'github'),
        ),
      );

    const existingExact = new Map(
      existing
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => [r.pattern, r.id]),
    );

    const desiredSet = new Set(desired);

    const toInsert = desired.filter((p) => !existingExact.has(p));
    const toDelete = [...existingExact.entries()]
      .filter(([pattern]) => !desiredSet.has(pattern))
      .map(([, id]) => id);

    for (const id of toDelete) {
      await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.id, id),
            eq(schema.connectorAllowlists.organizationId, orgId),
          ),
        );
    }
    if (toInsert.length > 0) {
      await db.insert(schema.connectorAllowlists).values(
        toInsert.map((pattern) => ({
          organizationId: orgId,
          provider: 'github',
          pattern,
          patternKind: 'exact_id' as const,
          decision: 'include' as const,
          createdBy: userId,
        })),
      );
    }

    // If anything actually changed and the user has at least one selected repo,
    // kick off a one-shot sync so they don't have to wait for the next 6h tick.
    let triggeredSync = false;
    if ((toInsert.length > 0 || toDelete.length > 0) && desired.length > 0) {
      const sourceRows = await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, 'github'),
          ),
        );
      for (const s of sourceRows) {
        await enqueueResync('github', { sourceId: s.id, organizationId: orgId });
        triggeredSync = true;
      }
    }

    return NextResponse.json({
      added: toInsert,
      removed: toDelete.length,
      total: desired.length,
      triggeredSync,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
