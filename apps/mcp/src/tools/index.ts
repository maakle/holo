import { zodToJsonSchema } from 'zod-to-json-schema';
import type { DB } from '@holo/db';
import {
  searchInputSchema,
  runSearchTool,
} from './search.js';
import { getPrInputSchema, runGetPrTool } from './get-pr.js';
import { getThreadInputSchema, runGetThreadTool } from './get-thread.js';
import { getDocInputSchema, runGetDocTool } from './get-doc.js';
import { getCallInputSchema, runGetCallTool } from './get-call.js';
import { getTicketInputSchema, runGetTicketTool } from './get-ticket.js';
import { listSkillsInputSchema, runListSkillsTool } from './list-skills.js';
import { getSkillInputSchema, runGetSkillTool } from './get-skill.js';

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
    {
      name: 'get_call',
      description: 'Fetch a Grain meeting recording (summary + full transcript) by recording_id.',
      inputSchema: zodToJsonSchema(getCallInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetCallTool(ctx, args);
      },
    },
    {
      name: 'get_ticket',
      description: 'Fetch a Pylon support ticket (conversation history) by ticket_id.',
      inputSchema: zodToJsonSchema(getTicketInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetTicketTool(ctx, args);
      },
    },
    {
      name: 'list_skills',
      description:
        'List skills available to agents in this organization. Returns name, slug, version, status, and description. Filter by status (default: active).',
      inputSchema: zodToJsonSchema(listSkillsInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runListSkillsTool(ctx, args);
      },
    },
    {
      name: 'get_skill',
      description:
        'Retrieve the full content of a skill by id or slug. Returns the complete Anthropic Skill format including procedure and examples.',
      inputSchema: zodToJsonSchema(getSkillInputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      async run(ctx, args) {
        return runGetSkillTool(ctx, args);
      },
    },
  ];
}
