/**
 * Google Drive v3 API helpers.
 *
 * The framework's HttpClient always parses 200 responses as JSON, which works
 * for `/files` listings and `/about` but not for the export/download endpoints
 * — those return raw bytes. For raw payloads we shell out to `fetch` directly
 * with the bearer token so the byte stream isn't pushed through `JSON.parse`.
 *
 * Reference: https://developers.google.com/drive/api/reference/rest/v3
 */
import { ErrorCode, holoError } from '@holo/errors';
import type { ConnectorTokens, HttpClient } from '@holo/connector-framework';
import type {
  DriveAbout,
  DriveFile,
  DriveFilesPage,
  SharedDrivesPage,
} from './types';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const ABOUT_FIELDS = 'user(emailAddress,displayName,permissionId)';
const FILE_FIELDS =
  'id,name,mimeType,modifiedTime,createdTime,webViewLink,iconLink,size,trashed,parents,driveId,owners(emailAddress,displayName,permissionId),lastModifyingUser(emailAddress,displayName,permissionId),shortcutDetails(targetId,targetMimeType)';
const FILES_FIELDS = `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`;

/** Mime types Drive can natively export to text. */
export const NATIVE_DOC_MIME = 'application/vnd.google-apps.document';
export const NATIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const NATIVE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Plain-byte mime types we can decode as UTF-8 directly. */
export const PLAIN_TEXT_MIMES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'text/xml',
]);

/** Cap raw download / export size; prevents one huge sheet from blowing the heap. */
export const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

export async function getAbout(api: HttpClient): Promise<DriveAbout> {
  return api.get<DriveAbout>('/about', { query: { fields: ABOUT_FIELDS } });
}

export interface ListFilesArgs {
  /** Drive listing query (`q`). e.g. `modifiedTime > '...' and trashed = false`. */
  q: string;
  pageToken?: string | null;
  /** When set, restricts results to a specific shared drive (`driveId`). */
  driveId?: string;
  /** Required when paging across shared drives. */
  includeSharedDrives?: boolean;
}

/**
 * One page of `/files`. Always sets `supportsAllDrives=true` and
 * `includeItemsFromAllDrives=true` when scanning shared drives so the caller
 * can iterate across My Drive + Shared Drives with the same code path.
 */
export async function listFiles(
  api: HttpClient,
  args: ListFilesArgs,
): Promise<DriveFilesPage> {
  const query: Record<string, string> = {
    q: args.q,
    fields: FILES_FIELDS,
    pageSize: '100',
    orderBy: 'modifiedTime',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    spaces: 'drive',
  };
  if (args.pageToken) query['pageToken'] = args.pageToken;
  if (args.driveId) {
    query['driveId'] = args.driveId;
    query['corpora'] = 'drive';
  } else if (args.includeSharedDrives) {
    query['corpora'] = 'allDrives';
  } else {
    query['corpora'] = 'user';
  }
  return api.get<DriveFilesPage>('/files', { query });
}

export async function listSharedDrives(
  api: HttpClient,
  pageToken?: string | null,
): Promise<SharedDrivesPage> {
  const query: Record<string, string> = {
    fields: 'nextPageToken,drives(id,name)',
    pageSize: '100',
  };
  if (pageToken) query['pageToken'] = pageToken;
  return api.get<SharedDrivesPage>('/drives', { query });
}

export interface ListFolderChildrenArgs {
  /** Parent folder id. Use `'root'` for the impersonation user's My Drive root. */
  folderId: string;
  /**
   * When set, restrict to a specific Shared Drive — required for shared-drive
   * roots and any descendant of a shared drive. Omit for My Drive.
   */
  driveId?: string;
  pageToken?: string | null;
  /**
   * Extra `q` clauses ANDed onto the base "in parents and !trashed" filter.
   * Used by the picker for one-shot trees and by the spec to add modifiedTime
   * filters during incremental walks.
   */
  extraQuery?: string;
  /** Field set — caller picks based on whether they need owners etc. */
  fields?: string;
}

const CHILDREN_FIELDS_BASIC =
  'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,driveId,shortcutDetails(targetId,targetMimeType))';

/**
 * One page of `'<folderId>' in parents` listings. Always sets
 * supportsAllDrives + includeItemsFromAllDrives so the same call shape works
 * across My Drive and Shared Drives. The picker uses this to enumerate one
 * folder at a time; the spec uses it inside a BFS walk for folder-scoped
 * allowlist entries.
 */
export async function listFolderChildren(
  api: HttpClient,
  args: ListFolderChildrenArgs,
): Promise<DriveFilesPage> {
  const parts = [
    `'${args.folderId}' in parents`,
    `trashed = false`,
  ];
  if (args.extraQuery) parts.push(args.extraQuery);
  const query: Record<string, string> = {
    q: parts.join(' and '),
    fields: args.fields ?? CHILDREN_FIELDS_BASIC,
    pageSize: '200',
    orderBy: 'folder,name',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    spaces: 'drive',
  };
  if (args.driveId) {
    query['driveId'] = args.driveId;
    query['corpora'] = 'drive';
  } else {
    query['corpora'] = 'user';
  }
  if (args.pageToken) query['pageToken'] = args.pageToken;
  return api.get<DriveFilesPage>('/files', { query });
}

/** Fetch a single file by id. Used for `file:<id>` allowlist entries. */
export async function getFile(
  api: HttpClient,
  fileId: string,
): Promise<DriveFile> {
  return api.get<DriveFile>(`/files/${encodeURIComponent(fileId)}`, {
    query: {
      fields: FILE_FIELDS,
      supportsAllDrives: 'true',
    },
  });
}

/**
 * Export a native Google file (Doc/Sheet/Slides) as text. The framework's
 * HttpClient is JSON-only, so we issue this with a raw fetch using the
 * tokens carried on the sync context.
 */
export async function exportFileAsText(
  tokens: ConnectorTokens,
  fileId: string,
  mimeType: 'text/plain' | 'text/csv',
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}&supportsAllDrives=true`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    signal,
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Drive export(${fileId}, ${mimeType}) returned ${res.status}`,
      cause: (await res.text().catch(() => '')).slice(0, 500),
      fix:
        res.status === 401 || res.status === 403
          ? 'Re-authenticate the Google Drive integration.'
          : 'Retry the sync; if it persists, check Google Workspace status.',
    });
  }
  return readBodyAsText(res);
}

/**
 * Download a non-native file body via `alt=media`. Used for text/plain,
 * text/markdown, text/csv, etc. — *not* for binary formats like PDF.
 */
export async function downloadFileMedia(
  tokens: ConnectorTokens,
  fileId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    signal,
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Drive download(${fileId}) returned ${res.status}`,
      cause: (await res.text().catch(() => '')).slice(0, 500),
      fix:
        res.status === 401 || res.status === 403
          ? 'Re-authenticate the Google Drive integration.'
          : 'Retry the sync; if it persists, check Google Workspace status.',
    });
  }
  return readBodyAsText(res);
}

/**
 * Read up to MAX_BYTES of a Response body and decode as UTF-8. Drive doesn't
 * expose a hard cap on export sizes, and a 50 MB sheet would otherwise hold
 * the whole worker. Truncating here is safer than gambling on small docs.
 */
async function readBodyAsText(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  const sliced = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  return new TextDecoder('utf-8', { fatal: false }).decode(sliced);
}

/**
 * Build the `q` parameter for incremental file listing. We narrow to file
 * mime types we can read (native Google docs + plain-text uploads) so the
 * page count stays low; the alternative — fetching every file and filtering
 * client-side — wastes Drive's per-minute query budget.
 */
export function buildIncrementalListQuery(args: { since?: string }): string {
  const mimeFilter = [
    NATIVE_DOC_MIME,
    NATIVE_SHEET_MIME,
    NATIVE_SLIDES_MIME,
    ...PLAIN_TEXT_MIMES,
  ]
    .map((m) => `mimeType = '${m}'`)
    .join(' or ');
  const parts = [`(${mimeFilter})`, `trashed = false`];
  if (args.since) {
    // Drive expects an RFC 3339 timestamp; ISO-8601 with Z is accepted as-is.
    parts.push(`modifiedTime > '${args.since}'`);
  }
  return parts.join(' and ');
}
