import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { fetchLlmsIndex, normalizeBaseUrl } from '@holo/connectors';
import { assertPublicHttpUrl } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Mintlify connect handler.
 *
 * Inputs: { url: '<base-url>' } e.g. 'https://docs.kombo.dev'.
 *
 * Validation: fetch `<url>/llms.txt`. If reachable + parseable, the site is
 * a real Mintlify (or llms.txt-compatible) docs site and we persist a new
 * sources row keyed on the normalised URL. The `connector_credentials`
 * row is a per-org marker only — Mintlify is fully public, no token
 * needed; we store an empty string in the access_token slot to satisfy
 * the schema's NOT NULL.
 *
 * Multi-source: connecting another URL creates a second sources row under
 * the same provider. The dashboard shows one ConnectorRow per provider with
 * a count summary; per-source operations live on the manage sheet.
 */
export async function POST(req: Request) {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }

    const body = (await req.json().catch(() => null)) as { url?: string; token?: string } | null;
    // The wizard's apiKeyStep posts `{ token }`; we accept either name so the
    // generic step works without a custom URL step. Trim + reject empty.
    const rawUrl = (body?.url ?? body?.token ?? '').trim();
    if (!rawUrl) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'url is required',
        fix: 'Paste the docs site root, e.g. https://docs.kombo.dev',
      });
    }

    // Resolve + reject private/loopback/metadata addresses. Without this an
    // authenticated user can probe (and re-probe via the persisted source)
    // any host the worker can reach — cloud metadata, internal Redis, etc.
    const parsedUrl = await assertPublicHttpUrl(rawUrl);
    const baseUrl = normalizeBaseUrl(`${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`);

    // Probe llms.txt — if the site doesn't expose one, it's almost certainly
    // not a Mintlify site (or its admin disabled the feature). Reject early
    // so the user gets a clear error instead of a half-broken sync.
    let index;
    try {
      index = await fetchLlmsIndex(baseUrl);
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: status
          ? `${baseUrl}/llms.txt returned ${status}`
          : `Couldn't reach ${baseUrl}/llms.txt`,
        cause: (err as Error).message,
        fix: 'Verify the URL is a Mintlify-hosted docs site that publishes /llms.txt.',
      });
    }

    if (index.pages.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `${baseUrl}/llms.txt parsed but contained no pages`,
        fix: 'Confirm the docs site has at least one indexed page.',
      });
    }

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    // One connector_credentials row per (org, user). Public surface so the
    // token slot stores an empty string. Upsert so a stale row from a prior
    // attempt (any non-active status, or a leftover token) gets reactivated;
    // otherwise the connections page's `status='active'` filter keeps the
    // row stuck on "Not connected" even after a successful reconnect.
    await db
      .insert(schema.connectorCredentials)
      .values({
        organizationId: orgId,
        userId,
        provider: 'mintlify',
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

    // sources keyed on the URL — multiple sites per org sit side-by-side.
    // The framework's sync runner reads `metadata.baseUrl` via
    // `ctx.sourceMetadata`, so the URL needs to live there even though we
    // also store it in `external_id`.
    const siteName = index.title || baseUrl.replace(/^https?:\/\//, '');
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'mintlify',
        externalId: baseUrl,
        name: siteName,
        metadata: { baseUrl, pageCount: index.pages.length },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: siteName,
          metadata: { baseUrl, pageCount: index.pages.length },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'mintlify').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'mintlify',
      meta: { provider: 'mintlify', baseUrl, name: siteName },
    });

    return NextResponse.json({ ok: true, baseUrl, name: siteName, pageCount: index.pages.length });
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
