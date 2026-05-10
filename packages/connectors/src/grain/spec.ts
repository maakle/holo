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
import { listRecordings } from './api';
import { processRecording } from './chunking';

export interface GrainSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const recordingsCursorSchema = z
  .object({
    /** ISO `start_datetime` of the most-recent recording we've ingested. */
    latestStartedAt: z.string().optional(),
  })
  .default({});

type RecordingsCursor = z.infer<typeof recordingsCursorSchema>;

export function createGrainSpec(_opts: GrainSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'grain',
    displayName: 'Grain',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.grain },

    // Workspace Access Tokens see every recording in the Grain workspace;
    // Personal Access Tokens are scoped to the issuing user. The wire format
    // is identical (`Authorization: Bearer <token>`) so both work here — the
    // wizard guides the operator toward a WAT for full coverage.
    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.grain.com',
      // Grain's public API requires a versioned header on every call.
      defaultHeaders: {
        'Public-Api-Version': '2025-10-31',
        Accept: 'application/json',
      },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // Grain does not expose a workspace identifier. We probe /recordings
      // (the cheapest authenticated call) to validate the token, then fall
      // back to a stable singleton key per holo org.
      const { recordings } = await listRecordings(ctx.api, { include: {} });
      return {
        externalId: 'grain',
        name: 'Grain Workspace',
        raw: { recording_count: recordings.length },
      };
    },

    resources: [
      {
        id: 'recordings',
        displayName: 'Recordings',
        cursorSchema: recordingsCursorSchema,
        async sync(ctx: ResourceSyncContext<RecordingsCursor>): Promise<RecordingsCursor> {
          let cursor: string | undefined;
          let highestStartedAt = ctx.cursor.latestStartedAt;
          let pageNum = 0;

          do {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching recordings · page ${pageNum}`,
            });

            const page = await listRecordings(ctx.api, { cursor });

            for (const rec of page.recordings) {
              ctx.signal?.throwIfAborted();
              // Grain's v2 schema rejects any date filter on /recordings, so
              // we always sweep the full list and skip recordings we've
              // already ingested. The transcript fetch is the expensive call;
              // skipping here keeps incremental syncs cheap.
              if (
                ctx.cursor.latestStartedAt &&
                rec.start_datetime <= ctx.cursor.latestStartedAt
              ) {
                continue;
              }
              await processRecording(ctx, rec);
              if (!highestStartedAt || rec.start_datetime > highestStartedAt) {
                highestStartedAt = rec.start_datetime;
              }
            }

            cursor = page.nextCursor;
          } while (cursor);

          return { latestStartedAt: highestStartedAt };
        },
      },
    ],

    ui: {
      description: 'Meeting recordings with AI summary and transcript.',
      category: 'meetings',
    },
  });
}
