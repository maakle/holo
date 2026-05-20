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

/**
 * Extract provider-specific identifiers (issue number, recording id, file
 * path) and a canonical URL from the upload's relative path, based on the
 * session's `chunk_provider` tag.
 *
 * Why this exists: manual-upload chunks otherwise carry only `session_slug`
 * and `rel_path`. The citation pipeline (`packages/agent-tools/src/citations.ts`)
 * looks for provider-specific keys like `issue_number` / `recording_id` /
 * `file_path` to produce nice labels (`Pylon #8183`, `apps/.../foo.ts`) and the
 * URL-fn registry needs them to build clickable links. Stamping them here at
 * upload time means a manually-uploaded ticket cites identically to one synced
 * natively via a connector.
 *
 * Patterns assume the conventional folder shapes the matching exporters
 * produce. Unknown / unmatched paths return an empty object — the chunk still
 * gets indexed, just without the enrichment, falling back to the generic
 * citation label as before.
 */
function extractProviderMetadataFromPath(
  chunkProvider: string,
  relPath: string,
  sourceMeta: { repo_full_name?: string } & Record<string, unknown>,
): Record<string, unknown> {
  switch (chunkProvider) {
    case 'pylon': {
      // Match the Pylon export's `tickets/<date>-ticket-<id>/<file>` and
      // permissive variants (`ticket_8183.md`, `pylon-19584.md`, etc.).
      const m = relPath.match(/(?:ticket|pylon)[-_]?(\d+)/i);
      if (!m) return {};
      const issueNumber = Number(m[1]);
      if (!Number.isFinite(issueNumber)) return {};
      return {
        issue_number: issueNumber,
        url: `https://app.usepylon.com/issues?issueNumber=${issueNumber}`,
      };
    }
    case 'grain': {
      // Match `grain/<recording-id>/...` or filenames containing a UUID-like
      // recording id. Recording IDs are URL-safe slugs Grain emits; accept any
      // hex/alphanumeric/dash blob of length >= 8 to be permissive.
      const folderMatch = relPath.match(/(?:^|\/)grain\/([A-Za-z0-9-]{8,})(?:\/|$)/);
      const recId = folderMatch?.[1]
        ?? relPath.match(/recording[-_]?([A-Za-z0-9-]{8,})/i)?.[1];
      if (!recId) return {};
      return {
        recording_id: recId,
        url: `https://grain.com/share/recording/${recId}`,
      };
    }
    case 'github': {
      // For GitHub the relevant identifier IS the file path. Strip a leading
      // `codebase/` or `github/` segment (the convention our exporters use) so
      // the remainder matches what the native GitHub connector stamps as
      // `file_path` (repo-relative path).
      const filePath = relPath.replace(/^(?:codebase|github)\//, '');
      if (!filePath) return {};
      const out: Record<string, unknown> = { file_path: filePath };
      // If the upload session knows the repo (set on the source metadata when
      // creating the upload), we can also build the github.com blob URL.
      // Without it, the citation label still gets the file path inline and the
      // URL stays null — meaningfully better than the generic fallback.
      const repo = typeof sourceMeta.repo_full_name === 'string' ? sourceMeta.repo_full_name : null;
      if (repo) {
        out['repo_full_name'] = repo;
        out['url'] = `https://github.com/${repo}/blob/HEAD/${filePath}`;
      }
      return out;
    }
    case 'notion': {
      // Notion page IDs are 32-char hex; accept dashed UUIDs too.
      const m = relPath.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9-]{27,35})/i);
      const pageId = m?.[1];
      if (!pageId) return {};
      return {
        notion_page_id: pageId,
        url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
      };
    }
    default:
      return {};
  }
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

    // When the upload is tagged as a known native tool (pylon/grain/github/notion),
    // extract provider-specific identifiers from the relative path and stamp a
    // canonical URL. This is what lets the citation pipeline render
    // "Pylon #8183" labels and clickable `usepylon.com` / `grain.com` /
    // `github.com` URLs instead of generic "file · manual-upload" citations.
    // The patterns assume the conventional folder layouts produced by the
    // matching exporters (`tickets/<date>-ticket-<id>/...`, `grain/<id>/...`,
    // `codebase/<repo-rooted file path>`); upload paths that don't match the
    // patterns just skip the extraction and fall through to the generic label.
    const providerMeta = extractProviderMetadataFromPath(chunkProvider, relPath, meta);

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
        // Provider-specific identifiers + canonical URL extracted from the
        // upload path (see `extractProviderMetadataFromPath`). Empty for
        // unknown / unmatched chunk providers.
        ...providerMeta,
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
