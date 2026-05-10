import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { listGitlabAccessibleProjects } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueResync } from '@/lib/sync-queue';

/**
 * GitLab project picker. Mirrors the Slack channels picker shape: GET lists
 * the projects the user's token can see (same filter as the worker —
 * `membership=true`, `min_access_level>=20`, `archived=false`), annotated
 * with which ones already have an `include` allowlist row. PUT replaces the
 * allowlist with the user's selection and triggers a resync.
 *
 * Allowlist patterns are stored with `pattern_kind='exact_id'` and the
 * numeric project ID — the spec's resolveProjects matches both
 * pathWithNamespace and stringified id, so either works, but ID is stable
 * across renames. The path goes in `notes` so chips show `acme/backend-api`
 * instead of `12345`.
 */
async function loadGitlabAccessToken(
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
        eq(schema.connectorCredentials.provider, 'gitlab'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    )
    .orderBy(desc(schema.connectorCredentials.connectedAt))
    .limit(1);
  const token = rows[0]?.accessToken;
  if (!token) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'GitLab is not connected for this user',
      fix: 'Click Connect on the GitLab row before picking projects.',
    });
  }
  return token;
}

export async function GET() {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const token = await loadGitlabAccessToken(db, orgId, userId);
    const projects = await listGitlabAccessibleProjects({ token });

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
          eq(schema.connectorAllowlists.provider, 'gitlab'),
        ),
      );

    const includedExact = new Set(
      allowlist
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => r.pattern),
    );
    const includedGlobs = allowlist.filter(
      (r) => r.decision === 'include' && r.patternKind === 'glob',
    );
    const defaultAll = allowlist.filter((r) => r.decision === 'include').length === 0;

    return NextResponse.json({
      defaultAll,
      // Surface globs as-is so the UI can warn that they're hand-managed.
      // The picker only writes exact_id rows; existing globs are left alone.
      globs: includedGlobs.map((r) => r.pattern),
      projects: projects.map((p) => ({
        id: String(p.id),
        pathWithNamespace: p.pathWithNamespace,
        defaultBranch: p.defaultBranch,
        selected: includedExact.has(String(p.id)),
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

interface PutBody {
  projects?: string[];
  defaultAll?: boolean;
}

const PROJECT_ID_RE = /^\d+$/;

export async function PUT(req: Request) {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as PutBody;
    const defaultAll = body.defaultAll === true;
    const desired = !defaultAll && Array.isArray(body.projects)
      ? Array.from(new Set(body.projects))
      : [];

    if (!defaultAll && desired.length > 200) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${desired.length} projects (max 200)`,
        fix: 'Select 200 or fewer projects, or use default-all mode and rely on group-level access.',
      });
    }
    if (!defaultAll) {
      for (const id of desired) {
        if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: `Invalid GitLab project ID '${id}'`,
            fix: 'Project IDs must be the numeric ID from GitLab (Project → Settings → General).',
          });
        }
      }
    }

    // Load fresh project list once — used to populate the `notes` column with
    // the human-readable path so chips show `acme/backend-api` instead of `12345`.
    const token = await loadGitlabAccessToken(db, orgId, userId);
    const projects = await listGitlabAccessibleProjects({ token });
    const projectsById = new Map(projects.map((p) => [String(p.id), p]));

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
          eq(schema.connectorAllowlists.provider, 'gitlab'),
        ),
      );

    // Only touch our own (decision=include, kind=exact_id) rows. Glob rows
    // and exclude rows are hand-managed and we don't want the picker to
    // silently delete them.
    const existingExact = new Map(
      existing
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => [r.pattern, r.id]),
    );

    const desiredSet = new Set(desired);
    const toInsert = defaultAll ? [] : desired.filter((p) => !existingExact.has(p));
    const toDelete = defaultAll
      ? [...existingExact.values()]
      : [...existingExact.entries()]
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
          provider: 'gitlab',
          pattern,
          patternKind: 'exact_id' as const,
          decision: 'include' as const,
          createdBy: userId,
          notes: projectsById.get(pattern)?.pathWithNamespace ?? null,
        })),
      );
    }

    // Trigger a resync if the allowlist actually changed. Both prose and
    // code queues — enqueueResync hits every queue registered for the
    // provider in QUEUE_NAMES_BY_PROVIDER.
    let triggeredSync = false;
    if (toInsert.length > 0 || toDelete.length > 0) {
      const sourceRows = await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(
          and(eq(schema.sources.organizationId, orgId), eq(schema.sources.provider, 'gitlab')),
        );
      for (const s of sourceRows) {
        await enqueueResync('gitlab', { sourceId: s.id, organizationId: orgId });
        triggeredSync = true;
      }
    }

    return NextResponse.json({
      added: toInsert,
      removed: toDelete.length,
      total: defaultAll ? null : desired.length,
      defaultAll,
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
