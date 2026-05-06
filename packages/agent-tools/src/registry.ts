import { z, type ZodType } from 'zod';
import type { DB } from '@holo/db';
import { listCustomTools, buildCustomToolDefinition } from '@holo/custom-tools';
import { searchInputSchema, runSearchTool } from './tools/search.js';
import { getPrInputSchema, runGetPrTool } from './tools/get-pr.js';
import { getThreadInputSchema, runGetThreadTool } from './tools/get-thread.js';
import { getDocInputSchema, runGetDocTool } from './tools/get-doc.js';
import { getCallInputSchema, runGetCallTool } from './tools/get-call.js';
import { getTicketInputSchema, runGetTicketTool } from './tools/get-ticket.js';
import { listSkillsInputSchema, runListSkillsTool } from './tools/list-skills.js';
import { getSkillInputSchema, runGetSkillTool } from './tools/get-skill.js';
import { executeSkillInputSchema, runExecuteSkillTool } from './tools/execute-skill.js';

export interface ToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  activeToolAllowlist?: string[];
  userId?: string;
  anthropicApiKey?: string;
  /** Stable label identifying the calling agent. See McpSessionVars.user.agentIdentity. */
  agentIdentity?: string;
  /**
   * Trace identifier grouping all events from one logical interaction
   * (typically the MCP session id). Set per-request by the gateway.
   */
  traceId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isCustom?: boolean;
  run(ctx: ToolContext, args: unknown): Promise<unknown>;
}

interface BuiltinSpec {
  name: string;
  description: string;
  schema: ZodType;
  run(ctx: ToolContext, args: unknown): Promise<unknown>;
}

const BUILTINS: BuiltinSpec[] = [
  { name: 'search', description: 'Hybrid search across all ingested artifacts (vector + BM25, fused via RRF).', schema: searchInputSchema, run: (ctx, a) => runSearchTool(ctx, a) },
  { name: 'get_pr', description: 'Reassemble a GitHub PR (title + diff + review) by owner/repo/number.', schema: getPrInputSchema, run: (ctx, a) => runGetPrTool(ctx, a) },
  { name: 'get_thread', description: 'Fetch a Slack thread by channel and ts.', schema: getThreadInputSchema, run: (ctx, a) => runGetThreadTool(ctx, a) },
  { name: 'get_doc', description: 'Fetch a doc by artifact id, notion page id, or repo+path.', schema: getDocInputSchema, run: (ctx, a) => runGetDocTool(ctx, a) },
  { name: 'get_call', description: 'Fetch a Grain meeting recording (summary + full transcript) by recording_id.', schema: getCallInputSchema, run: (ctx, a) => runGetCallTool(ctx, a) },
  { name: 'get_ticket', description: 'Fetch a Pylon support ticket (conversation history) by ticket_id.', schema: getTicketInputSchema, run: (ctx, a) => runGetTicketTool(ctx, a) },
  { name: 'list_skills', description: 'List skills available to agents in this organization. Returns name, slug, version, status, and description. Filter by status (default: active).', schema: listSkillsInputSchema, run: (ctx, a) => runListSkillsTool(ctx, a) },
  { name: 'get_skill', description: 'Retrieve the full content of a skill by id or slug. Returns the complete Anthropic Skill format including procedure and examples.', schema: getSkillInputSchema, run: (ctx, a) => runGetSkillTool(ctx, a) },
  { name: 'execute_skill', description: "Execute a skill procedure step-by-step using the skill's written playbook. The skill must have executable=true in its frontmatter. Returns a run ID, per-step LLM responses, and a summary. This tool creates a skill_run record — it is NOT read-only.", schema: executeSkillInputSchema, run: (ctx, a) => runExecuteSkillTool({ ...ctx, anthropicApiKey: ctx.anthropicApiKey }, a) },
];

export async function listTools(ctx: ToolContext): Promise<ToolDefinition[]> {
  const builtIns: ToolDefinition[] = BUILTINS.map((b) => ({
    name: b.name,
    description: b.description,
    inputSchema: z.toJSONSchema(b.schema) as Record<string, unknown>,
    run: b.run,
  }));

  const customRows = await listCustomTools(ctx.db, ctx.organizationId);
  const customDefs: ToolDefinition[] = customRows.map((row) => {
    const def = buildCustomToolDefinition(row);
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      isCustom: true,
      run: (toolCtx, args) =>
        def.run(
          { db: toolCtx.db, organizationId: toolCtx.organizationId, userId: toolCtx.userId },
          args,
        ),
    };
  });

  return [...builtIns, ...customDefs];
}
