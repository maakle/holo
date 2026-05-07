import { z } from 'zod';
import {
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { ISSUES_QUERY, VIEWER_QUERY, graphql } from './api';
import { processIssue } from './chunking';
import type { LinearIssuesResponse, LinearViewerResponse } from './types';

export interface LinearSpecOptions {
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). Threads through both the auth strategy and the runtime client. */
  fetchImpl?: typeof fetch;
}

const issuesCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent issue we've ingested. */
    updatedAt: z.string().optional(),
  })
  .default({});

type IssuesCursor = z.infer<typeof issuesCursorSchema>;

export function createLinearSpec(opts: LinearSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'linear',
    displayName: 'Linear',

    auth: oauth2({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      authorizeUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scopes: ['read'],
      // Linear OAuth tokens default to ~10y; a refresh exchange isn't part
      // of their flow. On 401 during sync, the user must re-connect.
      refreshable: false,
      fetchImpl: opts.fetchImpl,
    }),

    http: {
      baseUrl: 'https://api.linear.app',
      // Linear meters by complexity score (1500/hour by default), not raw
      // RPS. A modest token-bucket keeps full-syncs from spiking; the
      // framework's 429 + Retry-After absorbs anything Linear pushes back on.
      // https://developers.linear.app/docs/graphql/working-with-the-graphql-api/rate-limiting
      rateLimit: { rps: 2, burst: 10 },
      retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const data = await graphql<LinearViewerResponse>(ctx.api, VIEWER_QUERY, {});
      return {
        externalId: data.viewer.organization.id,
        name: data.viewer.organization.name,
        raw: { viewer: data.viewer },
      };
    },

    resources: [
      {
        id: 'issues',
        displayName: 'Issues',
        cursorSchema: issuesCursorSchema,
        async sync(ctx: ResourceSyncContext<IssuesCursor>): Promise<IssuesCursor> {
          let after: string | null = null;
          let pageNum = 0;
          let highestUpdatedAt = ctx.cursor.updatedAt;

          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching issues · page ${pageNum}`,
            });

            const data: LinearIssuesResponse = await graphql<LinearIssuesResponse>(
              ctx.api,
              ISSUES_QUERY,
              { after, since: ctx.cursor.updatedAt ?? null },
            );

            for (const issue of data.issues.nodes) {
              ctx.signal?.throwIfAborted();
              await processIssue(ctx, issue);
              if (!highestUpdatedAt || issue.updatedAt > highestUpdatedAt) {
                highestUpdatedAt = issue.updatedAt;
              }
            }

            // Per-page checkpoint so a mid-sync crash doesn't replay
            // already-enqueued chunks.
            if (highestUpdatedAt) {
              await ctx.flushCursor({ updatedAt: highestUpdatedAt });
            }

            if (!data.issues.pageInfo.hasNextPage) break;
            after = data.issues.pageInfo.endCursor;
            if (!after) break;
          }

          return { updatedAt: highestUpdatedAt };
        },
      },
    ],

    ui: {
      description: 'Issues with title, description, status, priority, team, and labels.',
      category: 'project',
    },
  });
}
