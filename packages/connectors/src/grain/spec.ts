import { z } from 'zod';
import {
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { listRecordings } from './api';
import { processRecording } from './chunking';

export interface GrainSpecOptions {
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). Threads through both the auth strategy and the runtime client. */
  fetchImpl?: typeof fetch;
}

const recordingsCursorSchema = z
  .object({
    /** ISO `start_datetime` of the most-recent recording we've ingested. */
    latestStartedAt: z.string().optional(),
  })
  .default({});

type RecordingsCursor = z.infer<typeof recordingsCursorSchema>;

export function createGrainSpec(opts: GrainSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'grain',
    displayName: 'Grain',

    auth: oauth2({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      authorizeUrl: 'https://grain.com/_/public-api/oauth2/authorize',
      tokenUrl: 'https://api.grain.com/_/public-api/oauth2/token',
      scopes: [],
      refreshable: true,
      // Grain diverges from RFC 6749 by accepting JSON-encoded token bodies.
      bodyEncoding: 'json',
      fetchImpl: opts.fetchImpl,
    }),

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

            const page = await listRecordings(ctx.api, {
              cursor,
              updatedAfter: ctx.cursor.latestStartedAt,
            });

            for (const rec of page.recordings) {
              ctx.signal?.throwIfAborted();
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
