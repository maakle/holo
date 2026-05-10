import { z } from 'zod';
import { ErrorCode } from '@holo/errors';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  buildIncrementalListQuery,
  DRIVE_API_BASE,
  FOLDER_MIME,
  getAbout,
  getFile,
  listFiles,
  listFolderChildren,
  listSharedDrives,
} from './api';
import { processFile } from './chunking';
import {
  classifyScopes,
  MY_DRIVE_ALLOWLIST_KEY,
  type ClassifiedScopes,
} from './scopes';
import type { DriveFile } from './types';

// Re-export the scope marker + helpers so callers (wizard, manage sheet) can
// import them from the same place they import the spec.
export {
  MY_DRIVE_ALLOWLIST_KEY,
  encodeDriveScope,
  encodeFolderScope,
  encodeFileScope,
  parseScope,
  classifyScopes,
} from './scopes';

export interface GoogleDriveSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Drive's `q` filter is a watermark over `modifiedTime`. We persist the
 * highest modifiedTime seen this run; the next run uses it as the floor.
 *
 * One cursor row covers every allowlisted scope (drives + folders + files).
 * Drive returns results in ascending modifiedTime order within a single
 * `files.list` query; we advance the cursor monotonically across all
 * queries. Per-scope cursors would buy us nothing and would force us to
 * track which scopes still exist between runs.
 */
const filesCursorSchema = z
  .object({
    /** RFC 3339 timestamp of the most recently modified file we've ingested. */
    modifiedTime: z.string().optional(),
  })
  .default({});

type FilesCursor = z.infer<typeof filesCursorSchema>;

/**
 * `drive.readonly` covers My Drive + Shared Drives (read access to file
 * metadata + content). Defined in @holo/sync-providers so the wizard and
 * the worker share a single source. The connector is read-only by design —
 * we never request the broad `drive` scope. The Workspace admin lists
 * exactly these scopes in Admin Console → Security → API Controls →
 * Domain-wide Delegation when granting the SA's client_id.
 */
export { GOOGLEDRIVE_SCOPES } from '@holo/sync-providers';

export function createGoogleDriveSpec(opts: GoogleDriveSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'googledrive',
    displayName: 'Google Drive',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.googledrive },

    // The framework-bridge mints a fresh delegated access token before each
    // sync via Google's JWT bearer flow (loadGoogleServiceAccountToken) and
    // hands it to the spec via tokens.accessToken. The spec just attaches it
    // as a Bearer header.
    auth: apiKey(),

    http: {
      baseUrl: DRIVE_API_BASE,
      // Drive's per-user limit is 1000 queries per 100s by default. A modest
      // bucket keeps full-syncs from spiking; the framework's 429 + Retry-After
      // handling absorbs anything Google pushes back on.
      // https://developers.google.com/drive/api/guides/limits
      rateLimit: { rps: 5, burst: 20 },
      retry: { maxAttempts: 5, retryOn: [429, 500, 502, 503, 504] },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const about = await getAbout(ctx.api);
      return {
        externalId: about.user.permissionId,
        name: about.user.displayName || about.user.emailAddress,
        raw: { user: about.user },
      };
    },

    resources: [
      {
        id: 'files',
        displayName: 'Files',
        cursorSchema: filesCursorSchema,
        async sync(ctx: ResourceSyncContext<FilesCursor>): Promise<FilesCursor> {
          // Resolve the allowlist into typed scope buckets, with the
          // historical "everything" fallback when no rows are set. The
          // worker doesn't otherwise care about pattern shape — this is the
          // only place we interpret it.
          const scopes = resolveScopes(ctx);

          // No scopes resolved (allowlist filtered to nothing) — exit
          // early. Returning the cursor as-is means nothing advances.
          if (
            !scopes.fallbackEverything &&
            !scopes.hasMyDrive &&
            scopes.driveIds.size === 0 &&
            scopes.folderIds.size === 0 &&
            scopes.fileIds.size === 0
          ) {
            return ctx.cursor;
          }

          // Whole-drive scans use the same incremental query shape: mime
          // filter + modifiedTime watermark. Shared by My Drive, every
          // Shared Drive scope, and the default-all path.
          const wholeDriveQuery = buildIncrementalListQuery({
            since: ctx.cursor.modifiedTime,
          });

          // Folder walks add the mime + watermark to each per-folder list
          // query. The mime filter is OR-of-equality so we wrap it in
          // parens before AND-ing.
          const folderExtraQuery = wholeDriveQueryToExtra(wholeDriveQuery);

          let highestModifiedTime = ctx.cursor.modifiedTime;
          let pageNum = 0;

          async function ingestFile(file: DriveFile): Promise<void> {
            ctx.signal?.throwIfAborted();
            if (file.trashed) return;
            if (file.shortcutDetails) return; // shortcuts → resolved target syncs separately
            await processFile(ctx, file, { fetchImpl: opts.fetchImpl });
            if (!highestModifiedTime || file.modifiedTime > highestModifiedTime) {
              highestModifiedTime = file.modifiedTime;
            }
          }

          async function checkpoint(): Promise<void> {
            if (highestModifiedTime) {
              await ctx.flushCursor({ modifiedTime: highestModifiedTime });
            }
          }

          // ── Pass 1: whole-drive scopes ────────────────────────────────
          const wholeDrives = await resolveWholeDrives(ctx, scopes);
          for (const drive of wholeDrives) {
            let pageToken: string | null = null;
            do {
              ctx.signal?.throwIfAborted();
              pageNum += 1;
              ctx.reportProgress?.({
                current: pageNum,
                total: null,
                message: `Listing files · page ${pageNum}${drive.driveId ? ' (shared drive)' : ''}`,
              });
              const page = await listFiles(ctx.api, {
                q: wholeDriveQuery,
                pageToken,
                driveId: drive.driveId ?? undefined,
                includeSharedDrives: true,
              });
              for (const file of page.files) await ingestFile(file);
              await checkpoint();
              pageToken = page.nextPageToken ?? null;
            } while (pageToken);
          }

          // ── Pass 2: folder scopes (recursive walk) ───────────────────
          const visitedFolders = new Set<string>();
          const queue: Array<{ folderId: string; driveId?: string }> = [];
          for (const folderId of scopes.folderIds) queue.push({ folderId });

          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) break;
            if (visitedFolders.has(node.folderId)) continue;
            visitedFolders.add(node.folderId);

            // Two passes per folder: (a) sub-folders (no time filter — a
            // folder's modifiedTime doesn't reflect descendant changes),
            // (b) files matching mime + watermark.
            await listFolderSubfolders(ctx, node, (sub) => {
              if (!visitedFolders.has(sub.id)) {
                queue.push({ folderId: sub.id, driveId: sub.driveId ?? node.driveId });
              }
            });

            let pageToken: string | null = null;
            do {
              ctx.signal?.throwIfAborted();
              pageNum += 1;
              ctx.reportProgress?.({
                current: pageNum,
                total: null,
                message: `Walking folder · ${node.folderId.slice(0, 8)}…`,
              });
              const page = await listFolderChildren(ctx.api, {
                folderId: node.folderId,
                driveId: node.driveId,
                pageToken,
                extraQuery: folderExtraQuery,
                fields:
                  'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,iconLink,size,trashed,parents,driveId,owners(emailAddress,displayName,permissionId),lastModifyingUser(emailAddress,displayName,permissionId),shortcutDetails(targetId,targetMimeType))',
              });
              for (const file of page.files) {
                if (file.mimeType === FOLDER_MIME) continue; // handled by sub-pass
                await ingestFile(file);
              }
              await checkpoint();
              pageToken = page.nextPageToken ?? null;
            } while (pageToken);
          }

          // ── Pass 3: individual file scopes ───────────────────────────
          for (const fileId of scopes.fileIds) {
            ctx.signal?.throwIfAborted();
            try {
              const file = await getFile(ctx.api, fileId);
              // Skip if we've already seen this exact version on a prior
              // run — getFile doesn't support a modifiedTime filter, so we
              // check client-side against the cursor watermark.
              if (
                ctx.cursor.modifiedTime &&
                file.modifiedTime <= ctx.cursor.modifiedTime
              ) {
                continue;
              }
              await ingestFile(file);
              await checkpoint();
            } catch (err) {
              // A 404 here just means the file was deleted or moved out of
              // the impersonation user's view since the picker captured it.
              // Log + continue — one bad file shouldn't kill the run.
              const status = (err as { status?: number }).status;
              if (status === 404 || status === 403) continue;
              throw err;
            }
          }

          return { modifiedTime: highestModifiedTime };
        },
      },
    ],

    ui: {
      description:
        'Google Docs, Sheets, Slides, and uploaded text/markdown files across My Drive and Shared Drives.',
      category: 'docs',
    },
  });
}

interface ResolvedScopes extends ClassifiedScopes {
  /** When true, no allowlist rows were set — fall back to "every drive." */
  fallbackEverything: boolean;
}

function resolveScopes(ctx: ResourceSyncContext<FilesCursor>): ResolvedScopes {
  try {
    const result = evaluateAllowlist(ctx.allowlist, {
      provider: 'googledrive',
      organizationId: ctx.organizationId,
    });
    const classified = classifyScopes(result.resolved);
    return { ...classified, fallbackEverything: false };
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    return {
      hasMyDrive: false,
      driveIds: new Set(),
      folderIds: new Set(),
      fileIds: new Set(),
      fallbackEverything: true,
    };
  }
}

/**
 * Return the list of (driveId | null) pairs the worker should iterate at
 * the drive level. `null` represents the impersonation user's My Drive.
 * Honors the fallback-everything path so a connector with no allowlist
 * keeps its historical behaviour.
 */
async function resolveWholeDrives(
  ctx: ResourceSyncContext<FilesCursor>,
  scopes: ResolvedScopes,
): Promise<Array<{ key: string; driveId: string | null }>> {
  // If allowlist explicitly picked drives, only enumerate Shared Drives
  // we'll actually scan. Skip the listSharedDrives call when no drive
  // scopes are selected and we're not in fallback mode.
  if (!scopes.fallbackEverything && scopes.driveIds.size === 0 && !scopes.hasMyDrive) {
    return [];
  }

  const allDrives: Array<{ key: string; driveId: string | null }> = [];
  if (scopes.fallbackEverything || scopes.hasMyDrive) {
    allDrives.push({ key: MY_DRIVE_ALLOWLIST_KEY, driveId: null });
  }

  if (scopes.fallbackEverything || scopes.driveIds.size > 0) {
    let token: string | null | undefined = null;
    do {
      ctx.signal?.throwIfAborted();
      const page = await listSharedDrives(ctx.api, token);
      for (const d of page.drives) {
        if (scopes.fallbackEverything || scopes.driveIds.has(d.id)) {
          allDrives.push({ key: d.id, driveId: d.id });
        }
      }
      token = page.nextPageToken ?? null;
    } while (token);
  }

  return allDrives;
}

/**
 * Page through `'<folderId>' in parents and mimeType = folder` and call
 * `onSub` for each discovered sub-folder. Kept separate from the file
 * listing so we can omit the modifiedTime filter (folder modifiedTime
 * doesn't reflect descendant changes — skipping based on it would mask
 * newly-modified files inside).
 */
async function listFolderSubfolders(
  ctx: ResourceSyncContext<FilesCursor>,
  node: { folderId: string; driveId?: string },
  onSub: (sub: { id: string; driveId?: string }) => void,
): Promise<void> {
  let pageToken: string | null = null;
  do {
    ctx.signal?.throwIfAborted();
    const page = await listFolderChildren(ctx.api, {
      folderId: node.folderId,
      driveId: node.driveId,
      pageToken,
      extraQuery: `mimeType = '${FOLDER_MIME}'`,
      fields: 'nextPageToken,files(id,driveId)',
    });
    for (const f of page.files) {
      onSub({ id: f.id, driveId: f.driveId });
    }
    pageToken = page.nextPageToken ?? null;
  } while (pageToken);
}

/**
 * Convert the whole-drive incremental query (mime list + watermark) into a
 * form that can be ANDed into a folder-children list query. The shape is
 * identical — the drive-level helper already produces a fully-parenthesised
 * boolean expression — so we can pass it through verbatim.
 */
function wholeDriveQueryToExtra(q: string): string {
  return q;
}
