import { z } from 'zod';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { holoError, ErrorCode } from '@holo/errors';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { getUserMe, listProjectsPage, listTasksPage } from './api';
import { processTask } from './chunking';

export interface AsanaSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const tasksCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent task modified_at we've ingested. */
    modifiedAt: z.string().optional(),
  })
  .default({});

type TasksCursor = z.infer<typeof tasksCursorSchema>;

export function createAsanaSpec(_opts: AsanaSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'asana',
    displayName: 'Asana',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.asana },

    // Asana Personal Access Tokens are workspace-scoped to the issuing user
    // (https://developers.asana.com/docs/personal-access-token). Wire format
    // is `Authorization: Bearer <PAT>` — the same as OAuth tokens, so the
    // Bearer-prefix apiKey strategy covers both.
    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://app.asana.com/api/1.0',
      // Asana's published quota is ~150 req/min/token for free workspaces,
      // 1500/min for paid. A modest token bucket keeps full-syncs comfortable
      // below either tier; the framework's 429 + Retry-After absorbs spikes.
      // https://developers.asana.com/docs/rate-limits
      rateLimit: { rps: 2, burst: 10 },
      retry: { maxAttempts: 5, retryOn: [429, 500, 502, 503, 504] },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const me = await getUserMe(ctx.api);
      const workspace = me.workspaces[0];
      // Asana PATs always have at least one workspace; if they don't, the
      // token is useless for ingestion. Fail loudly so the connect flow
      // surfaces it instead of silently storing a token that syncs nothing.
      if (!workspace) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: 'Asana token has no workspaces',
          fix: 'Connect with an account that belongs to at least one Asana workspace.',
        });
      }
      return {
        externalId: workspace.gid,
        name: workspace.name,
        raw: { user: { gid: me.gid, name: me.name }, workspaces: me.workspaces },
      };
    },

    resources: [
      {
        id: 'tasks',
        displayName: 'Tasks',
        cursorSchema: tasksCursorSchema,
        async sync(ctx: ResourceSyncContext<TasksCursor>): Promise<TasksCursor> {
          let highestModifiedAt = ctx.cursor.modifiedAt;

          // Walk every workspace the PAT can see → every active project → every
          // task modified since the cursor. Asana doesn't offer a single
          // "tasks modified since X across the workspace" endpoint without
          // additional scoping; the project walk is the most reliable filter
          // that works on every plan tier.
          const me = await getUserMe(ctx.api);
          const workspaces = me.workspaces;

          let workspaceIdx = 0;
          for (const workspace of workspaces) {
            ctx.signal?.throwIfAborted();
            workspaceIdx += 1;
            ctx.reportProgress?.({
              current: workspaceIdx,
              total: workspaces.length,
              message: `Workspace ${workspace.name}`,
            });

            let projectOffset: string | undefined = undefined;
            while (true) {
              ctx.signal?.throwIfAborted();
              const projectsPage = await listProjectsPage(ctx.api, {
                workspaceGid: workspace.gid,
                offset: projectOffset,
              });

              for (const project of projectsPage.data) {
                ctx.signal?.throwIfAborted();

                let taskOffset: string | undefined = undefined;
                while (true) {
                  ctx.signal?.throwIfAborted();
                  const tasksPage = await listTasksPage(ctx.api, {
                    projectGid: project.gid,
                    modifiedSince: ctx.cursor.modifiedAt,
                    offset: taskOffset,
                  });

                  for (const task of tasksPage.data) {
                    ctx.signal?.throwIfAborted();
                    await processTask(ctx, task, workspace.gid);
                    if (!highestModifiedAt || task.modified_at > highestModifiedAt) {
                      highestModifiedAt = task.modified_at;
                    }
                  }

                  if (highestModifiedAt) {
                    // Per-page checkpoint so a mid-sync crash doesn't replay
                    // already-enqueued chunks.
                    await ctx.flushCursor({ modifiedAt: highestModifiedAt });
                  }

                  const nextTaskOffset = tasksPage.next_page?.offset;
                  if (!nextTaskOffset) break;
                  taskOffset = nextTaskOffset;
                }
              }

              const nextProjectOffset = projectsPage.next_page?.offset;
              if (!nextProjectOffset) break;
              projectOffset = nextProjectOffset;
            }
          }

          return { modifiedAt: highestModifiedAt };
        },
      },
    ],

    ui: {
      description: 'Tasks with name, notes, status, assignee, projects, and tags.',
      category: 'project',
    },
  });
}
