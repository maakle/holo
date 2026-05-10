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
import { ISSUES_QUERY, VIEWER_QUERY, graphql } from './api';
import { processIssue } from './chunking';
import type { LinearIssuesResponse, LinearViewerResponse } from './types';

export interface LinearSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const issuesCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent issue we've ingested. */
    updatedAt: z.string().optional(),
  })
  .default({});

type IssuesCursor = z.infer<typeof issuesCursorSchema>;

export function createLinearSpec(_opts: LinearSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'linear',
    displayName: 'Linear',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.linear },

    // Linear personal API keys are workspace-issued (Settings → API → Personal
    // API keys) and stay valid as long as the issuing user has workspace
    // access. We pass the key directly with no `Bearer ` prefix — that's
    // Linear's documented format for personal API keys (OAuth tokens use
    // Bearer; we no longer support that path).
    auth: apiKey({ prefix: '' }),

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

            // Linear's `filter: { updatedAt: { gte: $since } }` returns zero
            // issues when $since is null — null isn't treated as "no filter".
            // On first sync (cursor empty) we anchor to the unix epoch so the
            // filter matches every issue. Incremental syncs pass the stored
            // ISO timestamp.
            const data: LinearIssuesResponse = await graphql<LinearIssuesResponse>(
              ctx.api,
              ISSUES_QUERY,
              { after, since: ctx.cursor.updatedAt ?? '1970-01-01T00:00:00.000Z' },
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
