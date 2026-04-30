import { zodToJsonSchema } from 'zod-to-json-schema';
import type { DB } from '@holo/db';
import {
  searchInputSchema,
  runSearchTool,
} from './search.js';
import { getPrInputSchema, runGetPrTool } from './get-pr.js';
import { getThreadInputSchema, runGetThreadTool } from './get-thread.js';
import { getDocInputSchema, runGetDocTool } from './get-doc.js';

export interface ToolContext {
  db: DB;
  organizationId: string;
  userSubjects?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, args: unknown): Promise<unknown>;
}

export function listTools(): ToolDefinition[] {
  return [
    {
      name: 'search',
      description:
        'Hybrid search across all ingested artifacts (vector + BM25, fused via RRF).',
      inputSchema: zodToJsonSchema(searchInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runSearchTool(ctx, args);
      },
    },
    {
      name: 'get_pr',
      description: 'Reassemble a GitHub PR (title + diff + review) by owner/repo/number.',
      inputSchema: zodToJsonSchema(getPrInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetPrTool(ctx, args);
      },
    },
    {
      name: 'get_thread',
      description: 'Fetch a Slack thread by channel and ts.',
      inputSchema: zodToJsonSchema(getThreadInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetThreadTool(ctx, args);
      },
    },
    {
      name: 'get_doc',
      description: 'Fetch a doc by artifact id, notion page id, or repo+path.',
      inputSchema: zodToJsonSchema(getDocInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetDocTool(ctx, args);
      },
    },
  ];
}
