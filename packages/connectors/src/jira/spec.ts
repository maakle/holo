import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  createHttpClient,
  defineConnector,
  type ConnectorSpec,
  type HttpConfig,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  buildIssuesJql,
  fetchMyself,
  searchIssues,
  searchProjects,
} from './api';
import { processIssue, processProject } from './chunking';

export interface JiraSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const issuesCursorSchema = z
  .object({
    /** Highest `updated` timestamp we've ingested (Jira ISO with timezone). */
    updatedAt: z.string().optional(),
  })
  .default({});

const projectsCursorSchema = z.object({}).default({});

type IssuesCursor = z.infer<typeof issuesCursorSchema>;
type ProjectsCursor = z.infer<typeof projectsCursorSchema>;

const PLACEHOLDER_BASE_URL = 'https://example.invalid';

const PER_TENANT_HTTP: Omit<HttpConfig, 'baseUrl'> = {
  // Atlassian uses dynamic rate limits + Retry-After on 429. Conservative
  // bucket here; framework absorbs anything the API pushes back on.
  rateLimit: { rps: 5, burst: 20 },
  retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
};

function requireSiteUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['siteUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Jira source ${ctx.sourceId} has no siteUrl in metadata`,
      fix: 'Reconnect Jira via /connections so the source row is initialised correctly.',
    });
  }
  return url;
}

export function createJiraSpec(opts: JiraSpecOptions = {}): ConnectorSpec {
  const auth = apiKey({ prefix: 'Basic ' });
  const fetchImpl = opts.fetchImpl;

  return defineConnector({
    id: 'jira',
    displayName: 'Jira',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.jira },

    auth,

    http: {
      // Placeholder. Every resource constructs its own per-tenant client
      // below — the per-tenant siteUrl lives on sources.metadata and isn't
      // available at spec-construction time.
      baseUrl: PLACEHOLDER_BASE_URL,
      ...PER_TENANT_HTTP,
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The connect route constructs a one-off HttpClient with the real
      // siteUrl and hands it in here; we just ask /myself and turn the
      // user account into a TestConnectionResult. The route's separate
      // serverInfo probe owns capturing cloudId into sources.metadata.
      const me = await fetchMyself(ctx.api);
      return {
        externalId: me.accountId,
        name: me.displayName,
        raw: { accountId: me.accountId, email: me.emailAddress },
      };
    },

    resources: [
      {
        id: 'issues',
        displayName: 'Issues',
        cursorSchema: issuesCursorSchema,
        async sync(ctx: ResourceSyncContext<IssuesCursor>): Promise<IssuesCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          let nextPageToken: string | undefined = undefined;
          let pageNum = 0;
          let highestUpdatedAt = ctx.cursor.updatedAt;
          const jql = buildIssuesJql(ctx.cursor.updatedAt);

          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching issues · page ${pageNum}`,
            });

            const page = await searchIssues(api, { jql, nextPageToken });

            for (const issue of page.issues) {
              ctx.signal?.throwIfAborted();
              await processIssue(ctx, issue, siteUrl);
              const updated = issue.fields.updated;
              if (!highestUpdatedAt || updated > highestUpdatedAt) {
                highestUpdatedAt = updated;
              }
            }

            if (highestUpdatedAt) {
              await ctx.flushCursor({ updatedAt: highestUpdatedAt });
            }

            if (page.isLast || !page.nextPageToken) break;
            nextPageToken = page.nextPageToken;
          }

          return { updatedAt: highestUpdatedAt };
        },
      },
      {
        id: 'projects',
        displayName: 'Projects',
        cursorSchema: projectsCursorSchema,
        async sync(ctx: ResourceSyncContext<ProjectsCursor>): Promise<ProjectsCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          let startAt = 0;
          let pageNum = 0;
          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching projects · page ${pageNum}`,
            });

            const page = await searchProjects(api, { startAt });
            for (const project of page.values) {
              ctx.signal?.throwIfAborted();
              await processProject(ctx, project, siteUrl);
            }
            if (page.isLast || page.values.length === 0) break;
            startAt += page.values.length;
          }
          return {};
        },
      },
    ],

    ui: {
      description: 'Issues, inline comments, and project metadata from Jira Cloud.',
      category: 'project',
    },
  });
}
