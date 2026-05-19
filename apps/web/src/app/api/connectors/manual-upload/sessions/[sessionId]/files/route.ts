import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
// Subpath import bypasses the chunker barrel (which pulls tree-sitter and
// would balloon the route's server bundle). Mirrors the configs.tsx pattern
// of preferring narrow client-safe imports from @holo packages.
import { recursiveSplit } from '@holo/chunker/recursive-split';
import {
  extToLanguage,
  isCodeExtension,
  shouldIndexByPath,
} from '@holo/connectors/code-skip';
import { schema } from '@holo/db';
import { ErrorCode, holoError, HoloError } from '@holo/errors';
import { getQueueByName } from '@/lib/sync-queue';
import { withActiveOrg } from '@/lib/with-active-org';
import {
  MANUAL_UPLOAD_MAX_FILE_BYTES,
  MANUAL_UPLOAD_PROVIDER,
  type ManualUploadSourceTool,
} from '@/lib/manual-upload';

// Mirror of the worker's `ChunkInsertPayload` / `EmbedJobPayload`
// (apps/worker/src/queues/embed-insert.ts). Re-declared here to avoid a
// web → worker source dep; the BullMQ payload is the contract.
interface ChunkInsertPayload {
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  aclSubjects?: string[];
  organizationId: string;
  sourceId: string;
  sourceArtifactId: string;
  provider: string;
  contentHash: string;
}
interface EmbedJobPayload {
  chunks: ChunkInsertPayload[];
  organizationId: string;
  sourceArtifactId: string;
}

// App Router 1 MB default on req.formData() bypassed by reading req.body as
// a stream. 60 s gives the chunker headroom for the largest .md files we
// expect (a few MB of prose).
export const runtime = 'nodejs';
export const maxDuration = 60;

// Prose-tuned defaults (markdown, docs, transcripts) — small chunks because
// retrieval over text is sentence-level and large chunks dilute embeddings.
const PROSE_CHUNK_SIZE = 1200;
const PROSE_CHUNK_OVERLAP = 150;

// Code-tuned defaults — match what the GitHub connector's code chunker uses
// ([packages/chunker/src/github-code.ts](../../../../../../packages/chunker/src/github-code.ts)),
// so a file uploaded manually as code retrieves identically to one synced
// natively. Bigger window keeps function/class scope together.
const CODE_CHUNK_SIZE = 4800;
const CODE_CHUNK_OVERLAP = 600;

function chunkHash(kind: string, content: string): string {
  return createHash('sha256').update(`${kind}:${content}`).digest('hex');
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<string> {
  if (!body) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'request body is empty',
      fix: 'Send the file content as the request body (Content-Type: text/markdown).',
    });
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `file exceeds the ${Math.round(cap / 1024 / 1024)} MB per-file limit`,
          fix: 'Split the file or trim trailing logs before re-uploading.',
        });
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  // strict: true rejects malformed UTF-8 with an error rather than substituting
  // U+FFFD — non-utf8 bytes indicate a binary file masquerading as .md.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'file is not valid UTF-8 text',
      fix: 'Only UTF-8 encoded text files are supported. Re-export the file as UTF-8 and retry.',
    });
  }
}

export const POST = withActiveOrg<{ sessionId: string }>(
  async ({ req, ctx, orgId, session, params }) => {
    const { db } = ctx;
    const userId = session.user.id;

    const [me] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
      )
      .limit(1);
    if (me?.role !== 'owner' && me?.role !== 'admin') {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'manual upload requires the workspace owner or admin role',
        fix: 'Ask a workspace owner or admin to upload.',
      });
    }

    const sessionId = params.sessionId;
    const [sourceRow] = await db
      .select({
        id: schema.sources.id,
        metadata: schema.sources.metadata,
      })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.id, sessionId),
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, MANUAL_UPLOAD_PROVIDER),
        ),
      )
      .limit(1);
    if (!sourceRow) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'manual upload session not found',
        fix: 'Refresh the page and start a new upload session.',
      });
    }

    const meta = (sourceRow.metadata ?? {}) as {
      session_slug?: string;
      source_tool?: ManualUploadSourceTool;
      chunk_provider?: string;
    };
    const sessionSlug = meta.session_slug ?? 'session';
    const sourceTool = meta.source_tool ?? 'other';
    const chunkProvider = meta.chunk_provider ?? MANUAL_UPLOAD_PROVIDER;

    const url = new URL(req.url);
    const relPath = (url.searchParams.get('rel_path') ?? '').trim();
    if (!relPath) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'rel_path query parameter is required',
        fix: 'Pass the file path relative to the picked folder, e.g. ?rel_path=grain/recording.md',
      });
    }
    if (relPath.includes('..') || relPath.startsWith('/')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `invalid rel_path '${relPath}'`,
        fix: 'rel_path must be relative and must not contain ".." segments.',
      });
    }
    // Same allow/deny policy the GitHub connector uses for code indexing —
    // rejects node_modules/.git/dist/etc. dirs, lockfiles, binary extensions,
    // and files outside the code/doc/config allow-lists. Size + binary-content
    // checks are enforced separately below via the 5 MB streaming cap and the
    // strict UTF-8 decode.
    if (!shouldIndexByPath(relPath)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `'${relPath}' is in an ignored directory or has an unsupported extension`,
        fix: 'Filter out node_modules, build output, binaries, and lockfiles before uploading.',
      });
    }

    const content = await readBoundedText(req.body, MANUAL_UPLOAD_MAX_FILE_BYTES);
    if (content.trim().length === 0) {
      // Empty file: no chunks to produce, but report success so the client's
      // progress tree marks it as handled rather than failed.
      return { artifactId: relPath, chunkCount: 0, skipped: 'empty' as const };
    }

    // Code files get the larger chunk window + `kind: 'github-code'` so the
    // embed-runner routes them to voyage-code-3 (see embed-runner.ts:33).
    // Docs/config/text fall back to the prose-tuned defaults.
    const isCode = isCodeExtension(relPath);
    const pieces = recursiveSplit(content, {
      chunkSize: isCode ? CODE_CHUNK_SIZE : PROSE_CHUNK_SIZE,
      overlap: isCode ? CODE_CHUNK_OVERLAP : PROSE_CHUNK_OVERLAP,
    });
    if (pieces.length === 0) {
      return { artifactId: relPath, chunkCount: 0, skipped: 'empty' as const };
    }

    const kind = isCode ? 'github-code' : 'manual-upload-file';
    const language = isCode ? extToLanguage(relPath) : undefined;
    // Synthetic source-artifact id: stable per (session, relPath). The worker's
    // embed-insert path looks up source_artifacts by (sourceId, externalId)
    // so the same file re-uploaded within the same session is idempotent.
    const syntheticArtifactId = relPath;
    const orgSubject = `org:${orgId}`;

    const chunks: ChunkInsertPayload[] = pieces.map((piece: string, i: number) => ({
      kind,
      content: piece,
      contentHash: chunkHash(kind, piece),
      organizationId: orgId,
      sourceId: sourceRow.id,
      sourceArtifactId: syntheticArtifactId,
      provider: chunkProvider,
      aclSubjects: [orgSubject],
      metadata: {
        session_slug: sessionSlug,
        rel_path: relPath,
        source_tool: sourceTool,
        chunk_index: i,
        chunk_count: pieces.length,
        // Language is part of the github-code chunk contract — surface it so
        // retrieval / UI / future re-chunking can branch on it.
        ...(language ? { language } : {}),
        // The web app's path-fn registry uses session_slug + rel_path to
        // compute the HoloFs path; embed-insert reads from metadata.
      },
    }));

    const payload: EmbedJobPayload = {
      chunks,
      organizationId: orgId,
      sourceArtifactId: syntheticArtifactId,
    };
    try {
      await getQueueByName('embed').add('embed', payload, {
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    } catch (err) {
      // BullMQ / Redis hiccup. Surface a 4xx-ish error so the client's progress
      // tree marks this file failed and the user can retry.
      if (err instanceof HoloError) throw err;
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: 'failed to enqueue embedding for uploaded file',
        fix: 'Retry the upload. If it keeps failing, check that Redis is reachable.',
      });
    }

    return { artifactId: syntheticArtifactId, chunkCount: pieces.length };
  },
);
