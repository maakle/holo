import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { assertPublicHttpUrl } from '@holo/connector-framework';
import { MAX_CRAWL_LIMIT } from '@holo/connectors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

/**
 * Webcrawl connect handler.
 *
 * Two modes selected by the wizard's first step (`mode: 'scrape' | 'crawl'`):
 *
 *   - scrape: { mode: 'scrape', urls: string[] } — creates one sources row
 *     per URL. The wizard supports adding multiple at once so the user
 *     doesn't have to round-trip the wizard for every page.
 *
 *   - crawl: { mode: 'crawl', seedUrl, limit, maxDepth, includePaths?,
 *     excludePaths? } — creates one sources row per seed.
 *
 * Validation: every URL must be a public HTTP(S) URL (`assertPublicHttpUrl`
 * rejects loopback, RFC1918, link-local, cloud metadata, etc.). We do NOT
 * pre-flight Firecrawl from the request thread — that would charge the
 * customer's credits before the wizard finishes — but the first sync after
 * connect will fail visibly if the URL isn't reachable.
 *
 * Storage matches the Mintlify shape: empty access_token on
 * connector_credentials (no per-org credential needed; Firecrawl key lives
 * in worker env), per-source config on `sources.metadata`.
 */
const scrapeRequestSchema = z.object({
  mode: z.literal('scrape'),
  /** One or more URLs; each becomes its own sources row. */
  urls: z.array(z.string().min(1)).min(1).max(20),
  /** Reconnect flow: wipe all existing webcrawl sources for the org before
   * inserting the new ones, so switching between scrape/crawl doesn't leave
   * the old mode's row(s) behind. */
  replace: z.boolean().optional(),
});

const crawlRequestSchema = z.object({
  mode: z.literal('crawl'),
  seedUrl: z.string().min(1),
  limit: z.number().int().positive().max(MAX_CRAWL_LIMIT).default(50),
  maxDepth: z.number().int().min(0).max(5).default(2),
  includePaths: z.array(z.string()).max(20).optional(),
  excludePaths: z.array(z.string()).max(20).optional(),
  replace: z.boolean().optional(),
});

const requestSchema = z.discriminatedUnion('mode', [
  scrapeRequestSchema,
  crawlRequestSchema,
]);

// Users naturally type "midlane.com" without a scheme. Server-side prepend
// `https://` rather than rejecting outright — the URL guard still validates
// the resolved URL, so this is just a UX courtesy, not a relaxation of the
// SSRF defence.
function ensureScheme(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

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

    const raw = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `webcrawl request body invalid: ${parsed.error.message}`,
        fix: 'POST { mode: "scrape", urls: [...] } or { mode: "crawl", seedUrl, limit, maxDepth, ... }.',
      });
    }

    const body = parsed.data;
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    // Validate every URL up front. assertPublicHttpUrl resolves DNS and
    // rejects private addresses — that's our SSRF defence. Doing this
    // before any DB writes means we don't end up with half-persisted
    // source rows when a single URL is bad.
    const validatedUrls: string[] = [];
    const inputUrls = body.mode === 'scrape' ? body.urls : [body.seedUrl];
    for (const u of inputUrls) {
      const candidate = ensureScheme(u);
      try {
        const parsedUrl = await assertPublicHttpUrl(candidate);
        validatedUrls.push(parsedUrl.toString());
      } catch (err) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Rejected URL "${u}": ${(err as Error).message}`,
          fix: 'Use a public https:// URL.',
        });
      }
    }

    // Upsert one credentials row per (org, user) — empty token slot. Same
    // pattern as Mintlify; the real "credential" (Firecrawl key) lives on
    // the worker, not per-org.
    await db
      .insert(schema.connectorCredentials)
      .values({
        organizationId: orgId,
        userId,
        provider: 'webcrawl',
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

    // Reconnect / edit flow: the form is the canonical state — drop any
    // existing webcrawl sources for this org so switching mode (crawl →
    // scrape or vice versa) doesn't leave the prior row behind. The
    // upsert-by-externalId below would otherwise miss them because the
    // externalId for crawl ("crawl:<url>") differs from scrape ("<url>").
    if (body.replace) {
      await db
        .delete(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, 'webcrawl'),
          ),
        );
    }

    const createdSources: Array<{ externalId: string; name: string }> = [];

    if (body.mode === 'scrape') {
      for (const url of validatedUrls) {
        const name = displayNameForUrl(url);
        await db
          .insert(schema.sources)
          .values({
            organizationId: orgId,
            provider: 'webcrawl',
            externalId: url,
            name,
            metadata: { mode: 'scrape', url },
          })
          .onConflictDoUpdate({
            target: [
              schema.sources.organizationId,
              schema.sources.provider,
              schema.sources.externalId,
            ],
            set: {
              name,
              metadata: { mode: 'scrape', url },
              updatedAt: new Date(),
            },
          });
        createdSources.push({ externalId: url, name });
      }
    } else {
      const seedUrl = validatedUrls[0]!;
      const externalId = `crawl:${seedUrl}`;
      const name = displayNameForUrl(seedUrl);
      const metadata: Record<string, unknown> = {
        mode: 'crawl',
        seedUrl,
        limit: body.limit,
        maxDepth: body.maxDepth,
      };
      if (body.includePaths && body.includePaths.length > 0) {
        metadata['includePaths'] = body.includePaths;
      }
      if (body.excludePaths && body.excludePaths.length > 0) {
        metadata['excludePaths'] = body.excludePaths;
      }
      await db
        .insert(schema.sources)
        .values({
          organizationId: orgId,
          provider: 'webcrawl',
          externalId,
          name,
          metadata,
        })
        .onConflictDoUpdate({
          target: [
            schema.sources.organizationId,
            schema.sources.provider,
            schema.sources.externalId,
          ],
          set: { name, metadata, updatedAt: new Date() },
        });
      createdSources.push({ externalId, name });
    }

    await enqueueInitialSync(db, orgId, 'webcrawl').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'webcrawl',
      meta: {
        provider: 'webcrawl',
        mode: body.mode,
        sourceCount: createdSources.length,
        // URLs themselves are stored on sources.metadata; the audit row gets
        // only the count so the audit log doesn't double-store them.
      },
    });

    return NextResponse.json({
      ok: true,
      mode: body.mode,
      sources: createdSources,
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

/**
 * GET — return the existing webcrawl sources for the active org. The wizard
 * calls this when the Reconnect button opens the form so the inputs pre-fill
 * with whatever was last saved (scrape URLs, or the crawl seed + limits).
 * Without it, reconnect would always start blank and the user would either
 * have to retype everything or assume their old config is gone.
 */
export async function GET() {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { code: 'HOLO_AUTH_NO_SESSION', problem: 'must be signed in', fix: 'Sign in first.' },
        { status: 401 },
      );
    }
    const orgId = resolveActiveOrgId(session);

    const rows = await db
      .select({ externalId: schema.sources.externalId, metadata: schema.sources.metadata })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, 'webcrawl'),
        ),
      );

    return NextResponse.json({ sources: rows });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), { status: 400 });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Check server logs.' },
      { status: 500 },
    );
  }
}

/** Display name for the connections sheet — host + first path segment. */
function displayNameForUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    return path ? `${u.host}/${path.split('/')[0]}` : u.host;
  } catch {
    return url;
  }
}
