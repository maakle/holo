import { z } from 'zod';
import {
  defineConnector,
  oauth2,
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
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). Threads through both auth and HTTP. */
  fetchImpl?: typeof fetch;
}

/**
 * Drive's `q` filter is a watermark over `modifiedTime`. We persist the
 * highest modifiedTime seen this run; the next run uses it as the floor.
 *
 * One cursor row covers My Drive *and* every Shared Drive: Drive returns
 * results in ascending modifiedTime order, and the watermark is global to
 * the user's view. Per-drive cursors would buy us nothing and would force
 * us to track which drives still exist between runs.
 */
const filesCursorSchema = z
  .object({
    /** RFC 3339 timestamp of the most recently modified file we've ingested. */
    modifiedTime: z.string().optional(),
  })
  .default({});

type FilesCursor = z.infer<typeof filesCursorSchema>;

/**
 * Append Google-specific authorize params (`access_type=offline`,
 * `prompt=consent`) by stuffing them into the base URL. The framework's
 * oauth2 strategy detects the existing query string and appends with `&`,
 * so this composes cleanly with the standard client_id/redirect_uri params.
 *
 * Without `access_type=offline` Google never returns a refresh token, and
 * the integration silently breaks the moment the access token expires.
 * `prompt=consent` forces re-issuance on re-auth so the refresh token is
 * present even if the user previously connected.
 */
const AUTHORIZE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&include_granted_scopes=true';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * `drive.readonly` covers My Drive + Shared Drives (read access to file
 * metadata + content). `drive.metadata.readonly` is implied. We do not
 * request the broad `drive` scope — the connector is read-only by design.
 */
const SCOPES: ReadonlyArray<string> = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function createGoogleDriveSpec(opts: GoogleDriveSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'googledrive',
    displayName: 'Google Drive',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.googledrive },

    auth: oauth2({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      authorizeUrl: AUTHORIZE_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      refreshable: true,
      fetchImpl: opts.fetchImpl,
    }),

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

          // Drives we'll iterate. `null` is My Drive; everything else is a
          // Shared Drive id. Listing the user's shared drives once at the
          // top of the run — they don't change mid-sync, and pulling them
          // up front means we don't repeat the listSharedDrives call per
          // page of files.
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
