import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  fetchPrismicRepository,
  getPrismicMasterRef,
  isValidPrismicRepoName,
  parsePrismicRepoInput,
} from '@holo/connectors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enforceConnectorLimit } from '@/lib/connector-gate';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Prismic connect handler.
 *
 * Inputs: { repo: 'beglaubigt' | 'https://beglaubigt.cdn.prismic.io/api/v2', token?: string }
 *
 * Validation: hit `/api/v2` on the repo's CDN with the optional PAT. A 200
 * means the repo exists and we're allowed to read it; 401/403 means the repo
 * is private and the supplied token doesn't grant access. Either way we
 * fail loudly so the user sees a clear error in the wizard.
 *
 * Storage:
 *   - `connector_credentials`: per-org marker row, empty access_token (the
 *     real token, if any, lives on the source row — see below).
 *   - `sources`: one row per repo. metadata: { repo, accessToken?, typeCount }.
 *     The token is per-source because two different repos may need two
 *     different PATs; the credentials row is one-per-org.
 *
 * Multi-source: connecting another repo creates a second sources row under
 * the same provider, same pattern as Mintlify.
 */
export async function POST(req: Request) {
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

    const body = (await req.json().catch(() => null)) as {
      repo?: string;
      token?: string;
      url?: string;
    } | null;

    // The wizard's apiKeyStep posts `{ token }` regardless of input kind; for
    // this connector that single field carries the repo slug or URL, not a
    // PAT. `repo`/`url` are accepted too for direct API callers. Reject empty
    // after trim.
    const rawRepo = (body?.repo ?? body?.url ?? body?.token ?? '').trim();
    if (!rawRepo) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'repo is required',
        fix: 'Paste the Prismic repository name, e.g. `beglaubigt`, or its API URL.',
      });
    }

    const repo = parsePrismicRepoInput(rawRepo);
    if (!repo || !isValidPrismicRepoName(repo)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `"${rawRepo}" is not a valid Prismic repository name`,
        fix: 'Use the bare slug (e.g. `beglaubigt`) or the full *.prismic.io URL.',
      });
    }

    // Optional PAT for private repositories. Only treat `token` as a PAT when
    // the caller supplied `repo`/`url` explicitly — otherwise the wizard's
    // single field is already being read into `rawRepo` above.
    const tokenCarriesRepo = !body?.repo && !body?.url;
    const accessToken =
      !tokenCarriesRepo && typeof body?.token === 'string' && body.token.trim().length > 0
        ? body.token.trim()
        : undefined;

    // Probe /api/v2. If reachable + parseable, the repo exists and we can
    // read it. 401/403 surfaces as a typed setup error so the wizard can
    // prompt for a PAT (or a corrected one).
    let repository;
    try {
      repository = await fetchPrismicRepository(repo, accessToken);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: `Prismic repository "${repo}" requires authentication (${status})`,
          cause: (err as Error).message,
          fix: 'Provide a Prismic Personal Access Token with read access to the repository.',
        });
      }
      if (status === 404) {
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: `Prismic repository "${repo}" not found`,
          cause: (err as Error).message,
          fix: 'Verify the repository slug (the part before `.prismic.io`).',
        });
      }
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: status
          ? `Prismic /api/v2 returned ${status} for "${repo}"`
          : `Couldn't reach Prismic /api/v2 for "${repo}"`,
        cause: (err as Error).message,
        fix: 'Verify the repository slug and that Prismic is reachable.',
      });
    }

    // Confirm we got a usable repo descriptor — protects against an HTML/error
    // body that still returns 200 from a proxy in front of Prismic.
    try {
      getPrismicMasterRef(repository);
    } catch (err) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Prismic /api/v2 for "${repo}" returned an unexpected body`,
        cause: (err as Error).message,
        fix: 'Confirm the repository slug points at a real Prismic repo.',
      });
    }

    const typeCount = Object.keys(repository.types ?? {}).length;
    const name = `${repo}.prismic.io`;
    const orgId = resolveActiveOrgId(session);

    // Plan-limit gate (free → 1 connector). No-op for re-auth and for self-hosted CE.
    await enforceConnectorLimit(db, orgId, 'prismic');
    const userId = session.user.id;

    // One connector_credentials row per (org, user). Token slot is empty
    // (Prismic's optional PAT lives on the source row; see header comment).
    // Upsert so a stale non-active row reactivates on reconnect — same
    // reason Mintlify upserts here.
    await db
      .insert(schema.connectorCredentials)
      .values({
        organizationId: orgId,
        userId,
        provider: 'prismic',
        accessToken: '',
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [
          schema.connectorCredentials.organizationId,
          schema.connectorCredentials.provider,
          schema.connectorCredentials.userId,
        ],
        set: { accessToken: '', status: 'active' },
      });

    // sources keyed on the repo slug so multiple repos sit side-by-side.
    // The sync runner reads `metadata.repo` and `metadata.accessToken` via
    // `ctx.sourceMetadata` — both need to live here.
    const sourceMetadata: Record<string, unknown> = { repo, typeCount };
    if (accessToken) sourceMetadata['accessToken'] = accessToken;

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'prismic',
        externalId: repo,
        name,
        metadata: sourceMetadata,
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name,
          metadata: sourceMetadata,
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'prismic').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'prismic',
      // Token deliberately excluded from the audit row — only the repo slug
      // and shape are interesting; the token is a credential.
      meta: { provider: 'prismic', repo, typeCount, hasToken: Boolean(accessToken) },
    });

    return NextResponse.json({ ok: true, repo, name, typeCount });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_INVALID_INPUT' || e.code === 'HOLO_FETCH_FAILED'
            ? 400
            : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Check server logs.' },
      { status: 500 },
    );
  }
}
