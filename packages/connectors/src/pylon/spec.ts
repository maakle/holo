import { z } from 'zod';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { searchIssues } from './api';
import { processTicket } from './chunking';

export interface PylonSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const ticketsCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent ticket we've ingested. */
    latestUpdatedAt: z.string().optional(),
  })
  .default({});

type TicketsCursor = z.infer<typeof ticketsCursorSchema>;

export function createPylonSpec(_opts: PylonSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'pylon',
    displayName: 'Pylon',

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.usepylon.com',
      defaultHeaders: { Accept: 'application/json' },
      // Pylon doesn't publish a hard rate limit; the framework's exponential
      // backoff on 429/5xx is sufficient.
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const raw = await ctx.api.get<{ data: { id: string; name: string } }>('/me');
      return {
        externalId: raw.data.id,
        name: raw.data.name,
        raw: { org_id: raw.data.id, org_name: raw.data.name },
      };
    },

    resources: [
      {
        id: 'tickets',
        displayName: 'Tickets',
        cursorSchema: ticketsCursorSchema,
        async sync(ctx: ResourceSyncContext<TicketsCursor>): Promise<TicketsCursor> {
          let cursor: string | undefined;
          let highestUpdatedAt = ctx.cursor.latestUpdatedAt;
          let pageNum = 0;

          do {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching tickets · page ${pageNum}`,
            });

            const page = await searchIssues(ctx.api, {
              cursor,
              updatedAfter: ctx.cursor.latestUpdatedAt,
            });

            for (const issue of page.data ?? []) {
              ctx.signal?.throwIfAborted();
              await processTicket(ctx, issue);
              if (!highestUpdatedAt || issue.updated_at > highestUpdatedAt) {
                highestUpdatedAt = issue.updated_at;
              }
            }

            cursor =
              page.pagination?.has_next_page && page.pagination.cursor
                ? page.pagination.cursor
                : undefined;
          } while (cursor);

          return { latestUpdatedAt: highestUpdatedAt };
        },
      },
    ],

    ui: {
      description: 'Customer support tickets and message threads.',
      category: 'support',
    },
  });
}
