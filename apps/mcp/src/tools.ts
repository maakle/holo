import { hybridSearch } from '@holo/retrieval-core';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export const SEARCH_TOOL = {
  name: 'search',
  description:
    "Hybrid keyword + semantic search across the workspace's connected sources " +
    '(Slack, GitHub, Notion, Grain, Pylon, HubSpot). Returns ranked content chunks.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Natural-language query.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'Maximum number of hits to return (1–50).',
      },
    },
    required: ['query'],
  },
};

export const TOOLS = [SEARCH_TOOL];

export async function callSearchTool(
  db: DB,
  organizationId: string,
  args: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const a = args as { query?: unknown; limit?: unknown } | null | undefined;
  if (!a || typeof a.query !== 'string') {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'search requires a string `query` argument',
      fix: 'Pass { query: "…" } in the tool arguments.',
    });
  }
  const limit =
    typeof a.limit === 'number' && Number.isFinite(a.limit) ? Math.floor(a.limit) : undefined;

  const hits = await hybridSearch(db, {
    query: a.query,
    organizationId,
    limit,
  });

  // MCP tools return content blocks. Pack each hit as a structured text block;
  // clients can parse / collapse / rerank as they like.
  if (hits.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            'No results. The workspace may not have ingested any data yet — connect a source ' +
            'at /dashboard/connections.',
        },
      ],
    };
  }

  const summary = hits
    .map(
      (h, i) =>
        `[${i + 1}] (${h.provider} · ${h.kind} · score=${h.score.toFixed(4)}) ` +
        `${h.content.slice(0, 320)}${h.content.length > 320 ? '…' : ''}`,
    )
    .join('\n\n');

  return { content: [{ type: 'text', text: summary }] };
}
