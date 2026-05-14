import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isSyncProvider, SYNC_PROVIDERS_FIX_HINT, type Provider } from '@/lib/sync-queue';

// Human labels for the kind strings emitted by each connector's chunker.
// Single source of truth for the modal's "Synchronized content" panel; if a
// new connector ships a kind not listed here it falls back to the raw kind
// (still legible, just not pretty-printed).
const KIND_LABELS: Record<string, { singular: string; plural: string }> = {
  'linear-issue': { singular: 'issue', plural: 'issues' },
  'notion-page': { singular: 'page', plural: 'pages' },
  'slack-thread': { singular: 'thread', plural: 'threads' },
  'pylon-ticket': { singular: 'ticket', plural: 'tickets' },
  'grain-call': { singular: 'call', plural: 'calls' },
  'github-code': { singular: 'code file', plural: 'code files' },
  'github-pr': { singular: 'pull request', plural: 'pull requests' },
  'github-issue': { singular: 'issue', plural: 'issues' },
  'github-doc': { singular: 'doc', plural: 'docs' },
  'gitlab-code': { singular: 'code file', plural: 'code files' },
  'gitlab-mr': { singular: 'merge request', plural: 'merge requests' },
  'gitlab-issue': { singular: 'issue', plural: 'issues' },
  'gitlab-doc': { singular: 'doc', plural: 'docs' },
  'hubspot-contact': { singular: 'contact', plural: 'contacts' },
  'hubspot-deal': { singular: 'deal', plural: 'deals' },
  'hubspot-company': { singular: 'company', plural: 'companies' },
  'hubspot-engagement': { singular: 'engagement', plural: 'engagements' },
  'mintlify-page': { singular: 'page', plural: 'pages' },
  'mintlify-openapi-endpoint': { singular: 'OpenAPI endpoint', plural: 'OpenAPI endpoints' },
  'zendesk-article': { singular: 'article', plural: 'articles' },
  'stripe-customer': { singular: 'customer', plural: 'customers' },
  'stripe-subscription': { singular: 'subscription', plural: 'subscriptions' },
  'stripe-invoice': { singular: 'invoice', plural: 'invoices' },
  'stripe-charge': { singular: 'charge', plural: 'charges' },
};

function labelFor(kind: string, count: number): string {
  const m = KIND_LABELS[kind];
  if (!m) return kind;
  return count === 1 ? m.singular : m.plural;
}

export interface StatsResponse {
  kinds: Array<{
    kind: string;
    label: string;
    artifactCount: number;
    chunkCount: number;
  }>;
  totals: {
    artifactCount: number;
    chunkCount: number;
  };
  /** Top-level HoloFs directory for this provider (e.g. "/slack"), so the
   * UI can deep-link the snapshot into the file explorer. Null when nothing
   * is indexed yet or no artifact has a path. */
  fileRoot: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!isSyncProvider(rawProvider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${rawProvider}'`,
        fix: SYNC_PROVIDERS_FIX_HINT,
      });
    }
    const provider: Provider = rawProvider;
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    // Source artifacts = "things we synced" (issues, pages, threads, …).
    // Joined through sources because `source_artifacts` is keyed by source_id
    // not org+provider directly. Skip soft-deleted rows so the totals match
    // what the user can actually retrieve.
    const artifactRows = await db
      .select({
        kind: schema.sourceArtifacts.kind,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.sourceArtifacts)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceArtifacts.sourceId))
      .where(
        and(
          eq(schema.sourceArtifacts.organizationId, orgId),
          eq(schema.sources.provider, provider),
          isNull(schema.sourceArtifacts.deletedAt),
        ),
      )
      .groupBy(schema.sourceArtifacts.kind);

    // Chunks = embedding units (one artifact → many chunks). Direct query —
    // chunks carries `provider` and `organization_id` columns, no join needed.
    const chunkRows = await db
      .select({
        kind: schema.chunks.kind,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.chunks)
      .where(
        and(
          eq(schema.chunks.organizationId, orgId),
          eq(schema.chunks.provider, provider),
        ),
      )
      .groupBy(schema.chunks.kind);

    // Merge by kind. A kind can show up in chunks but not artifacts (or vice
    // versa) during partial syncs — surface both so the user sees the truth
    // rather than a kind silently disappearing.
    const byKind = new Map<string, { artifactCount: number; chunkCount: number }>();
    for (const r of artifactRows) {
      byKind.set(r.kind, { artifactCount: r.count, chunkCount: 0 });
    }
    for (const r of chunkRows) {
      const existing = byKind.get(r.kind);
      if (existing) {
        existing.chunkCount = r.count;
      } else {
        byKind.set(r.kind, { artifactCount: 0, chunkCount: r.count });
      }
    }

    const kinds = Array.from(byKind.entries())
      .map(([kind, counts]) => ({
        kind,
        label: labelFor(kind, counts.artifactCount || counts.chunkCount),
        artifactCount: counts.artifactCount,
        chunkCount: counts.chunkCount,
      }))
      .sort((a, b) => b.artifactCount - a.artifactCount);

    // Sample one artifact path to derive the provider's HoloFs root segment.
    // All path-fns for a given provider share the same first segment
    // (e.g. every github-* kind starts with /github/), so one row is enough.
    const sampleRow = await db
      .select({ path: schema.sourceArtifacts.path })
      .from(schema.sourceArtifacts)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceArtifacts.sourceId))
      .where(
        and(
          eq(schema.sourceArtifacts.organizationId, orgId),
          eq(schema.sources.provider, provider),
          isNull(schema.sourceArtifacts.deletedAt),
          sql`${schema.sourceArtifacts.path} IS NOT NULL`,
        ),
      )
      .limit(1);
    const samplePath = sampleRow[0]?.path ?? null;
    const firstSeg = samplePath?.split('/').filter(Boolean)[0] ?? null;
    const fileRoot = firstSeg ? `/${firstSeg}` : null;

    const response: StatsResponse = {
      kinds,
      totals: {
        artifactCount: kinds.reduce((acc, k) => acc + k.artifactCount, 0),
        chunkCount: kinds.reduce((acc, k) => acc + k.chunkCount, 0),
      },
      fileRoot,
    };
    return NextResponse.json(response);
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
