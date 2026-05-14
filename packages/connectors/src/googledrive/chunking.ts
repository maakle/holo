/**
 * Drive file → chunk projection. Native Google Docs/Sheets/Slides are exported
 * via `/files/.../export`; plain-text uploads are pulled with `alt=media`.
 * Anything else (PDF, images, binary office formats) is skipped here — Drive
 * can't natively export them to text and pure-JS extraction isn't worth the
 * heap cost in the sync worker. Add OCR / pdf-text upstream and revisit.
 */
import { recursiveSplit } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import {
  NATIVE_DOC_MIME,
  NATIVE_SHEET_MIME,
  NATIVE_SLIDES_MIME,
  PLAIN_TEXT_MIMES,
  downloadFileMedia,
  exportFileAsText,
} from './api';
import type { DriveFile } from './types';

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

export const GOOGLEDRIVE_FILE_KIND = 'googledrive-file';

interface ProcessFileOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Try to materialise a file's body as a single text string. Returns null
 * when the file's mime type isn't text-extractable in pure JS.
 */
export async function fetchFileText(
  ctx: ResourceSyncContext<unknown>,
  file: DriveFile,
  opts: ProcessFileOptions = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = ctx.signal;

  switch (file.mimeType) {
    case NATIVE_DOC_MIME:
      return exportFileAsText(ctx.tokens, file.id, 'text/plain', fetchImpl, signal);
    case NATIVE_SHEET_MIME:
      return exportFileAsText(ctx.tokens, file.id, 'text/csv', fetchImpl, signal);
    case NATIVE_SLIDES_MIME:
      return exportFileAsText(ctx.tokens, file.id, 'text/plain', fetchImpl, signal);
    default:
      if (PLAIN_TEXT_MIMES.has(file.mimeType)) {
        const raw = await downloadFileMedia(ctx.tokens, file.id, fetchImpl, signal);
        return file.mimeType === 'text/html' ? stripHtml(raw) : raw;
      }
      return null;
  }
}

/**
 * Loose HTML → text. Strips tags and collapses whitespace; not a substitute
 * for a real parser but enough to make HTML uploads searchable.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ownerLabel(file: DriveFile): string | undefined {
  const owner = file.owners?.[0] ?? file.lastModifyingUser;
  if (!owner) return undefined;
  return owner.displayName || owner.emailAddress;
}

function aclSubjectsFor(file: DriveFile, organizationId: string): string[] {
  // Drive's per-file ACL is rich (per-user, per-group, anyone-with-link). We
  // currently scope every chunk to the org and, for shared-drive files, to
  // the drive id — that's enough to keep retrieval inside the workspace
  // boundary. Future work: surface per-permission ids so retrieval can match
  // a viewing user against the file's permission list.
  const subjects = [`org:${organizationId}`];
  if (file.driveId) subjects.push(`googledrive:drive:${file.driveId}`);
  else subjects.push('googledrive:my-drive');
  return subjects;
}

/**
 * Project a single Drive file into chunks via ctx.upsert. No-ops for files
 * whose body we can't extract — those still consumed listing budget but we
 * don't surface empty chunks to the embed pipeline.
 */
export async function processFile(
  ctx: ResourceSyncContext<unknown>,
  file: DriveFile,
  opts: ProcessFileOptions = {},
): Promise<void> {
  const body = await fetchFileText(ctx, file, opts);
  if (body === null) return;
  const trimmed = body.trim();
  if (trimmed.length === 0) return;

  const sourceArtifactId = `${GOOGLEDRIVE_FILE_KIND}:${file.id}`;
  const aclSubjects = aclSubjectsFor(file, ctx.organizationId);
  const owner = ownerLabel(file);
  const baseMeta: Record<string, unknown> = {
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? null,
    driveId: file.driveId ?? null,
    owner: owner ?? null,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
  };

  const header = owner ? `${file.name} · ${owner}` : file.name;
  const url = file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;

  const pieces = recursiveSplit(trimmed, {
    chunkSize: CHUNK_SIZE,
    overlap: CHUNK_OVERLAP,
  });

  for (let i = 0; i < pieces.length; i += 1) {
    await ctx.upsert({
      externalId: file.id,
      kind: GOOGLEDRIVE_FILE_KIND,
      content: `${header}\n${url}\n\n${pieces[i]}`,
      aclSubjects,
      sourceArtifactId,
      metadata: {
        ...baseMeta,
        url,
        chunk_index: i,
        chunk_count: pieces.length,
      },
    });
  }
}
