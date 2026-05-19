import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema } from '@holo/db';
import { ErrorCode, holoError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { withActiveOrg } from '@/lib/with-active-org';
import {
  MANUAL_UPLOAD_PROVIDER,
  isManualUploadSourceTool,
  sourceToolToChunkProvider,
  type ManualUploadSourceTool,
} from '@/lib/manual-upload';

// Index signature satisfies the jsonb column's `Record<string, unknown>`
// shape while still letting us type the well-known fields below.
interface SessionMetadata extends Record<string, unknown> {
  source_tool: ManualUploadSourceTool;
  uploaded_by_user_id: string;
  uploaded_at: string;
  session_slug: string;
  // Provider id stamped on every chunk for retrieval. Either a real connector
  // id (e.g. 'grain') when the user tagged a known tool, or
  // 'manual-upload' for 'other'.
  chunk_provider: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Strip combining diacritics (U+0300..U+036F) by codepoint range so
      // the character class doesn't fall foul of no-misleading-character-class.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session'
  );
}

async function assertOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  orgId: string,
  userId: string,
): Promise<void> {
  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  if (me?.role !== 'owner') {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_FORBIDDEN,
      problem: 'manual upload requires the org owner role',
      fix: 'Ask your workspace owner to upload, or have them grant you the owner role.',
    });
  }
}

export const POST = withActiveOrg(async ({ req, ctx, orgId, session }) => {
  const { db } = ctx;
  const userId = session.user.id;

  await assertOwner(db, orgId, userId);

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    source_tool?: string;
  } | null;
  const name = body?.name?.trim();
  const tool = body?.source_tool?.trim();
  if (!name) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'session name is required',
      fix: 'Provide a non-empty name (e.g. "grain-export-2026-05").',
    });
  }
  if (!tool || !isManualUploadSourceTool(tool)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `unknown source_tool '${tool ?? ''}'`,
      fix: 'Pick one of: grain, pylon, hubspot, notion, github, slack, salesforce, other.',
    });
  }

  // External id: random uuid keeps sessions isolated and lets the same name
  // be reused across uploads. Slug is for the file-explorer path.
  const externalId = randomUUID();
  const sessionSlug = slugify(name);
  const metadata: SessionMetadata = {
    source_tool: tool,
    uploaded_by_user_id: userId,
    uploaded_at: new Date().toISOString(),
    session_slug: sessionSlug,
    chunk_provider: sourceToolToChunkProvider(tool),
  };

  const [row] = await db
    .insert(schema.sources)
    .values({
      organizationId: orgId,
      provider: MANUAL_UPLOAD_PROVIDER,
      externalId,
      name,
      metadata,
    })
    .returning({ id: schema.sources.id });

  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'failed to create manual upload session',
      fix: 'Retry; this is almost always a transient DB hiccup.',
    });
  }

  emitAuditEvent({
    db,
    organizationId: orgId,
    userId,
    eventType: 'connector.connected',
    resourceType: 'connector',
    resourceId: MANUAL_UPLOAD_PROVIDER,
    meta: { provider: MANUAL_UPLOAD_PROVIDER, sessionId: row.id, source_tool: tool, name },
  });

  return { sessionId: row.id, sessionSlug };
});

export const GET = withActiveOrg(async ({ ctx, orgId }) => {
  const { db } = ctx;
  const rows = await db
    .select({
      id: schema.sources.id,
      name: schema.sources.name,
      metadata: schema.sources.metadata,
      createdAt: schema.sources.createdAt,
    })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, orgId),
        eq(schema.sources.provider, MANUAL_UPLOAD_PROVIDER),
      ),
    )
    .orderBy(desc(schema.sources.createdAt));

  if (rows.length === 0) {
    return { sessions: [] };
  }

  // File and chunk counts per source for the manage drawer. Two indexed scans
  // are cheap and avoid a complex correlated subquery in Drizzle.
  const sourceIds = rows.map((r) => r.id);
  const artifactCounts = await db
    .select({
      sourceId: schema.sourceArtifacts.sourceId,
      c: sql<number>`count(*)::int`,
    })
    .from(schema.sourceArtifacts)
    .where(inArray(schema.sourceArtifacts.sourceId, sourceIds))
    .groupBy(schema.sourceArtifacts.sourceId);
  const chunkCounts = await db
    .select({
      sourceId: schema.chunks.sourceId,
      c: sql<number>`count(*)::int`,
    })
    .from(schema.chunks)
    .where(inArray(schema.chunks.sourceId, sourceIds))
    .groupBy(schema.chunks.sourceId);
  const artifactBySource = new Map(artifactCounts.map((r) => [r.sourceId, r.c]));
  const chunkBySource = new Map(chunkCounts.map((r) => [r.sourceId, r.c]));

  return {
    sessions: rows.map((r) => {
      const meta = (r.metadata ?? {}) as Partial<SessionMetadata>;
      return {
        id: r.id,
        name: r.name,
        sourceTool: meta.source_tool ?? 'other',
        chunkProvider: meta.chunk_provider ?? MANUAL_UPLOAD_PROVIDER,
        sessionSlug: meta.session_slug ?? null,
        uploadedAt: r.createdAt.toISOString(),
        fileCount: artifactBySource.get(r.id) ?? 0,
        chunkCount: chunkBySource.get(r.id) ?? 0,
      };
    }),
  };
});
