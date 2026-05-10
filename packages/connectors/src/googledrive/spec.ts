import { z } from 'zod';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  buildIncrementalListQuery,
  DRIVE_API_BASE,
  getAbout,
  listFiles,
  listSharedDrives,
} from './api';
import { processFile } from './chunking';

export interface GoogleDriveSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Drive's `q` filter is a watermark over `modifiedTime`. We persist the
 * highest modifiedTime seen this run; the next run uses it as the floor.
 *
 * One cursor row covers My Drive *and* every Shared Drive: Drive returns
 * results in ascending modifiedTime order, and the watermark is global to
 * the impersonated user's view. Per-drive cursors would buy us nothing and
 * would force us to track which drives still exist between runs.
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
          let highestModifiedTime = ctx.cursor.modifiedTime;
          let pageNum = 0;

          // Drives we'll iterate. `null` is the impersonated user's My Drive;
          // everything else is a Shared Drive id. Listing the user's shared
          // drives once at the top of the run — they don't change mid-sync,
          // and pulling them up front means we don't repeat the
          // listSharedDrives call per page of files.
          const driveIds: Array<string | null> = [null];
          {
            let token: string | null | undefined = null;
            do {
              ctx.signal?.throwIfAborted();
              const page = await listSharedDrives(ctx.api, token);
              for (const d of page.drives) driveIds.push(d.id);
              token = page.nextPageToken ?? null;
            } while (token);
          }

          const q = buildIncrementalListQuery({ since: ctx.cursor.modifiedTime });

          for (const driveId of driveIds) {
            let pageToken: string | null = null;
            do {
              ctx.signal?.throwIfAborted();
              pageNum += 1;
              ctx.reportProgress?.({
                current: pageNum,
                total: null,
                message: `Listing files · page ${pageNum}${driveId ? ` (shared drive)` : ''}`,
              });

              const page = await listFiles(ctx.api, {
                q,
                pageToken,
                driveId: driveId ?? undefined,
                includeSharedDrives: true,
              });

              for (const file of page.files) {
                ctx.signal?.throwIfAborted();
                if (file.trashed) continue;
                if (file.shortcutDetails) continue; // shortcuts → real file syncs separately
                await processFile(ctx, file, { fetchImpl: opts.fetchImpl });
                if (!highestModifiedTime || file.modifiedTime > highestModifiedTime) {
                  highestModifiedTime = file.modifiedTime;
                }
              }

              // Per-page checkpoint so a mid-sync crash doesn't replay
              // already-enqueued chunks on resume.
              if (highestModifiedTime) {
                await ctx.flushCursor({ modifiedTime: highestModifiedTime });
              }

              pageToken = page.nextPageToken ?? null;
            } while (pageToken);
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
