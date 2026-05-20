import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { iterateArticlesIncremental } from '@holo/connectors';
import { assertPublicHttpUrl } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enforceConnectorLimit } from '@/lib/connector-gate';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Zendesk help-center connect handler.
 *
 * Inputs: { url: '<base-url>' } e.g. 'https://help.kombo.dev' or
 * 'https://kombo.zendesk.com'.
 *
 * Validation: probe the public help-center API at
 * `<url>/api/v2/help_center/articles.json` (the public listing — Zendesk's
 * `/incremental/...` path requires admin auth even on public help centers).
 * If reachable + parseable, the site is a Zendesk help center we can
 * sync. Persist a sources row keyed on the normalised URL — the framework
 * runtime reads `metadata.baseUrl` via `ctx.sourceMetadata` on each sync.
 *
 * Multi-source: connecting another URL creates a second sources row under
 * the same provider (same shape as Mintlify).
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
    // The wizard's apiKeyStep posts `{ token }`; we accept either name so
    // the generic step works without a custom URL step.
    const rawUrl = (body?.url ?? body?.token ?? '').trim();
    if (!rawUrl) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'url is required',
        fix: 'Paste the help-center root, e.g. https://help.kombo.dev',
      });
    }

    // Resolve + reject private/loopback/metadata addresses. Zendesk help
    // centers run on either *.zendesk.com or customer apex domains, so we
    // can't host-allowlist; the IP-based check is what stops an
    // authenticated user from probing internal services here or via the
    // persisted source on every sync tick.
    const parsedUrl = await assertPublicHttpUrl(rawUrl);

    // Strip the path entirely — Zendesk help-center URLs land on
    // /hc/en-us/<...> in the browser, but the API hangs off the host
    // root. `https://help.kombo.dev/hc/en-us` → `https://help.kombo.dev`.
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

    // Probe — fetch the first page of the incremental articles feed. If
    // the host isn't a Zendesk help center, this 404s with non-JSON.
    let firstPage;
    try {
      const iter = iterateArticlesIncremental(baseUrl, 0);
      const first = await iter.next();
      firstPage = first.done ? null : first.value;
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: status
          ? `${baseUrl}/api/v2/help_center/articles.json returned ${status}`
          : `Couldn't reach Zendesk Help Center API at ${baseUrl}`,
        cause: (err as Error).message,
        fix: 'Verify the URL is a Zendesk-hosted help center (custom domain or *.zendesk.com).',
      });
    }

    if (!firstPage) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `${baseUrl} returned no articles`,
        fix: 'Confirm the help center has at least one published article.',
      });
    }

    const orgId = resolveActiveOrgId(session);

    // Plan-limit gate (free → 1 connector). No-op for re-auth and for self-hosted CE.
    await enforceConnectorLimit(db, orgId, 'zendesk');
    const userId = session.user.id;

    // Singleton connector_credentials row per (org, user). Public surface
    // so the access-token slot stores an empty string. Upsert (not
    // insert-if-not-exists) so a prior attempt that left a row in any
    // non-active state — or with a stale token — gets reactivated; otherwise
    // the connections page filter (`status='active'`) keeps showing
    // "Not connected" even though the source row is healthy.
    await db
      .insert(schema.connectorCredentials)
      .values({
        organizationId: orgId,
        userId,
        provider: 'zendesk',
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

    const siteName = baseUrl.replace(/^https?:\/\//, '');
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'zendesk',
        externalId: baseUrl,
        name: siteName,
        metadata: { baseUrl },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: { name: siteName, metadata: { baseUrl }, updatedAt: new Date() },
      });

    await enqueueInitialSync(db, orgId, 'zendesk').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'zendesk',
      meta: { provider: 'zendesk', baseUrl, name: siteName },
    });

    return NextResponse.json({
      ok: true,
      baseUrl,
      name: siteName,
      sampleArticleCount: firstPage.articles.length,
    });
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
