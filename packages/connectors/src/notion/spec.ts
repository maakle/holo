import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { iterateAllAccessiblePages, NOTION_VERSION_HEADER, viewer, isStatus } from './api';
import { processPages } from './chunking';

export interface NotionSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const pagesCursorSchema = z
  .object({
    /**
     * Map of `page_id → last_edited_time` we've ingested. Pages whose
     * `last_edited_time` hasn't moved past this value get their content
     * skipped (we still recurse children, since a leaf can change without
     * bumping its parent).
     */
    lastEditedPerPage: z.record(z.string(), z.string()).default({}),
  })
  .default({ lastEditedPerPage: {} });

type PagesCursor = z.infer<typeof pagesCursorSchema>;

/**
 * Wildcard expansion: when the operator's allowlist contains a `*` glob,
 * the integration's Notion-side share boundary is the access policy. We
 * enumerate every page the token can see (capped to 1000 to avoid runaway
 * walks on huge workspaces) and treat that as the resolved set.
 */
async function expandWildcardToAccessiblePages(
  ctx: ResourceSyncContext<PagesCursor>,
): Promise<string[]> {
  const ids = new Set<string>();
  let count = 0;
  for await (const page of iterateAllAccessiblePages(ctx.api, ctx.signal)) {
    ids.add(page.id);
    count += 1;
    if (count >= 1000) break;
  }
  return [...ids];
}

export function createNotionSpec(_opts: NotionSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'notion',
    displayName: 'Notion',

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.notion.com/v1',
      defaultHeaders: {
        'Notion-Version': NOTION_VERSION_HEADER,
        Accept: 'application/json',
      },
      // Notion publishes ~3 rps per integration; keep slightly under to
      // leave headroom and let the framework's 429 + Retry-After absorb
      // bursts.
      rateLimit: { rps: 2.5, burst: 5 },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      try {
        const me = await viewer(ctx.api);
        return {
          externalId: me.id,
          name: me.workspace_name ?? me.name ?? me.id,
          raw: me as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (isStatus(err, 401)) {
          throw holoError({
            code: ErrorCode.HOLO_NOTION_TOKEN_INVALID,
            problem: 'Notion returned 401 — integration token is invalid',
            fix: 'Verify the token at https://www.notion.so/my-integrations and update it.',
          });
        }
        throw err;
      }
    },

    resources: [
      {
        id: 'pages',
        displayName: 'Pages',
        cursorSchema: pagesCursorSchema,
        async sync(ctx: ResourceSyncContext<PagesCursor>): Promise<PagesCursor> {
          // The Notion connect-route auto-populates a `*` glob on first
          // connect (Notion's share UI is the access boundary). Operators
          // can later narrow via `holo allowlist add notion <pattern>`.
          const result = evaluateAllowlist(ctx.allowlist, {
            provider: 'notion',
            organizationId: ctx.organizationId,
          });

          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Resolving accessible pages…',
          });
          const rootPageIds = result.resolved.includes('*')
            ? await expandWildcardToAccessiblePages(ctx)
            : result.resolved;

          if (rootPageIds.length === 0) {
            return ctx.cursor;
          }

          const out = await processPages({
            ctx,
            rootPageIds,
            lastEditedPerPage: ctx.cursor.lastEditedPerPage ?? {},
          });
          return { lastEditedPerPage: out.lastEditedPerPage };
        },
      },
    ],

    ui: {
      description: 'Pages and child databases the integration has access to.',
      category: 'docs',
    },
  });
}
