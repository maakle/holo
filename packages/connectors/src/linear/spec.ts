import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type HttpClient,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { ISSUES_QUERY, VIEWER_QUERY } from './queries';
import type {
  GraphqlEnvelope,
  LinearIssue,
  LinearIssuesResponse,
  LinearViewerResponse,
} from './types';

export interface LinearSpecOptions {
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). Threads through both the auth strategy and the runtime client. */
  fetchImpl?: typeof fetch;
}

const GRAPHQL_PATH = '/graphql';

const issuesCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent issue we've ingested. */
    updatedAt: z.string().optional(),
  })
  .default({});

type IssuesCursor = z.infer<typeof issuesCursorSchema>;

/**
 * Issue many GraphQL requests through the framework's HTTP client. Linear
 * surfaces errors inside the JSON envelope (`{ errors: [...] }`) at HTTP 200,
 * so we can't rely on the framework's status-based error path alone.
 */
async function graphql<T>(
  api: HttpClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const envelope = await api.post<GraphqlEnvelope<T>>(GRAPHQL_PATH, {
    query,
    variables,
  });
  if (envelope.errors && envelope.errors.length > 0) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Linear GraphQL: ${envelope.errors.map((e) => e.message).join('; ')}`,
      fix: 'If this persists, check Linear app permissions and OAuth scope.',
    });
  }
  if (!envelope.data) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: 'Linear GraphQL response had no `data` field',
      fix: 'Retry the sync; if it persists, check Linear status.',
    });
  }
  return envelope.data;
}

/**
 * One chunk per issue. Linear issues are typically short (a few hundred
 * tokens at most), so keeping the issue intact preserves all the context an
 * agent needs in a single retrieval. If we ever start ingesting issue
 * comments we'll split them out as a sibling resource with their own
 * chunker.
 */
function projectIssueToContent(issue: LinearIssue): string {
  const lines: string[] = [];
  lines.push(`[${issue.identifier}] ${issue.title}`);

  const meta: string[] = [];
  meta.push(`Status: ${issue.state.name}`);
  if (issue.priorityLabel) meta.push(`Priority: ${issue.priorityLabel}`);
  meta.push(`Team: ${issue.team.name}`);
  if (issue.project) meta.push(`Project: ${issue.project.name}`);
  if (issue.assignee) meta.push(`Assignee: ${issue.assignee.name}`);
  if (issue.labels.nodes.length > 0) {
    meta.push(`Labels: ${issue.labels.nodes.map((l) => l.name).join(', ')}`);
  }
  lines.push(meta.join(' · '));

  if (issue.description && issue.description.trim().length > 0) {
    lines.push('');
    lines.push(issue.description.trim());
  }
  return lines.join('\n');
}

function aclSubjectsFor(issue: LinearIssue): string[] {
  // For v0.1 every issue is org-scoped — Linear does not surface fine-grained
  // ACLs on issues themselves. The team identity becomes useful later for
  // limiting answers to "what was your team working on?" without leaking
  // other teams.
  return [`linear:team:${issue.team.id}`, `linear:org`];
}

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
      // Linear OAuth tokens default to ~10y; issuing a refresh isn't part of
      // their flow. If we see 401s during sync, the user must re-connect.
      refreshable: false,
      fetchImpl: opts.fetchImpl,
    }),

    http: {
      baseUrl: 'https://api.linear.app',
      // Linear meters by complexity score (1500/hour by default), not raw
      // RPS. A modest token-bucket keeps full-syncs from spiking; the
      // framework's 429 + Retry-After handling will absorb anything Linear
      // pushes back on. See https://developers.linear.app/docs/graphql/working-with-the-graphql-api/rate-limiting
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
              await ctx.upsert({
                externalId: issue.id,
                kind: 'linear-issue',
                content: projectIssueToContent(issue),
                aclSubjects: aclSubjectsFor(issue),
                metadata: {
                  identifier: issue.identifier,
                  url: issue.url,
                  state: issue.state.name,
                  stateType: issue.state.type,
                  teamKey: issue.team.key,
                  teamId: issue.team.id,
                  projectId: issue.project?.id ?? null,
                  assigneeId: issue.assignee?.id ?? null,
                  priority: issue.priority,
                  priorityLabel: issue.priorityLabel,
                  createdAt: issue.createdAt,
                  updatedAt: issue.updatedAt,
                  labels: issue.labels.nodes.map((l) => l.name),
                },
              });
              if (!highestUpdatedAt || issue.updatedAt > highestUpdatedAt) {
                highestUpdatedAt = issue.updatedAt;
              }
            }

            // Checkpoint at each page boundary so a mid-sync crash doesn't
            // discard everything we've already enqueued. The runtime owns
            // batching; flushCursor flushes the partial cursor row.
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
