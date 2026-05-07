import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  githubAppConfigFromEnv,
  loadGithubInstallationToken,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
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

interface InstallationRepositoriesResponse {
  total_count: number;
  repositories: GithubRepo[];
}

/**
 * Lists every repo the App's installation in this org has access to. Different
 * from the OAuth-era /user/repos call: this only returns repos the admin
 * actually selected at install time (or all repos if they chose "all").
 */
async function listInstallationRepos(token: string): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  let page = 1;
  while (page <= 10) {
    const url = new URL('https://api.github.com/installation/repositories');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
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
        problem: `GitHub /installation/repositories returned ${res.status}`,
        fix: 'Re-install the holo GitHub App and verify the admin granted access to repos.',
      });
    }
    const body = (await res.json()) as InstallationRepositoriesResponse;
    out.push(...body.repositories);
    if (body.repositories.length < 100) break;
    page += 1;
  }
  return out;
}

export async function GET() {
  try {
    const { auth, db, env, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session, defaultOrgId);

    const config = githubAppConfigFromEnv(env);
    const { token } = await loadGithubInstallationToken({
      db,
      organizationId: orgId,
      config,
    });
    const repos = await listInstallationRepos(token);

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

    const includes = allowlist.filter(
      (r) => r.decision === 'include' && r.patternKind === 'exact_id',
    );
    const includedExact = new Set(includes.map((r) => r.pattern));

    // Default-all mode: when no allowlist rows exist, the runner falls back
    // to "everything the installation can see" (Phase 3 / runners.ts). The
    // picker should reflect that — show every repo as selected, with a flag
    // the UI uses to render an "All repos · default" hint.
    const defaultAll = includes.length === 0;

    return NextResponse.json({
      defaultAll,
      repos: repos
        .filter((r) => !r.archived)
        .map((r) => ({
          fullName: r.full_name,
          private: r.private,
          description: r.description,
          fork: r.fork,
          pushedAt: r.pushed_at,
          selected: defaultAll ? true : includedExact.has(r.full_name),
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
    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      repos?: string[];
      defaultAll?: boolean;
    };

    // Two intent modes:
    //  - `defaultAll: true`   → clear the allowlist; runner falls back to
    //                            "all installation repos" via Phase 3 fallback.
    //  - `repos: [...]`       → narrow to exactly those repos; runner uses them.
    const defaultAll = body.defaultAll === true;
    const desired = Array.isArray(body.repos) ? Array.from(new Set(body.repos)) : [];
    if (!defaultAll && desired.length > 50) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${desired.length} repos (max 50)`,
        fix: 'Select 50 or fewer repos, or use the default-all mode.',
      });
    }
    if (!defaultAll) {
      for (const r of desired) {
        if (typeof r !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(r)) {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: `Invalid repo identifier '${r}'`,
            fix: 'Repos must be in `owner/name` form.',
          });
        }
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

    let toInsert: string[];
    let toDelete: string[];

    if (defaultAll) {
      // Clear every existing include row. The runner's Phase 3 fallback
      // takes over once the table is empty for this provider.
      toInsert = [];
      toDelete = [...existingExact.values()];
    } else {
      const desiredSet = new Set(desired);
      toInsert = desired.filter((p) => !existingExact.has(p));
      toDelete = [...existingExact.entries()]
        .filter(([pattern]) => !desiredSet.has(pattern))
        .map(([, id]) => id);
    }

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

    // Kick off a one-shot sync if anything actually changed. In default-all
    // mode this fires whenever we cleared rows (intent: refresh) or always
    // on first save (intent: ingest the freshly installed repos).
    let triggeredSync = false;
    const changed = toInsert.length > 0 || toDelete.length > 0;
    const hasReposToSync = defaultAll || desired.length > 0;
    if (changed && hasReposToSync) {
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
