import { z, type ZodType } from 'zod';
import type { DB } from '@holo/db';
import { listCustomTools, buildCustomToolDefinition } from '@holo/custom-tools';
import { searchInputSchema, runSearchTool } from './tools/search';
import { bashInputSchema, runBashTool, BASH_TOOL_DESCRIPTION } from './tools/bash';
// Legacy per-source getters (get_pr, get_thread, get_doc, get_call, get_ticket)
// were removed from the registry on 2026-05-14 in favour of `bash cat /...`.
// The implementation files in `./tools/get-*.ts` and `./tools/_artifact-lookup.ts`
// remain on disk for one telemetry cycle; once `mcp_invocations` confirms zero
// legacy traffic they can be deleted along with the dead-but-harmless string
// references in custom-tools, skills synthesis, slack-bot citation
// extraction, gateway allowlist tests, and the landing-page marketing copy.
import { listSkillsInputSchema, runListSkillsTool } from './tools/list-skills';
import { getSkillInputSchema, runGetSkillTool } from './tools/get-skill';
import { executeSkillInputSchema, runExecuteSkillTool } from './tools/execute-skill';
import { getAccountBriefInputSchema, runGetAccountBriefTool } from './tools/get-account-brief';
import { submitFeedbackInputSchema, runSubmitFeedbackTool } from './tools/submit-feedback';

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
  { name: 'bash', description: BASH_TOOL_DESCRIPTION, schema: bashInputSchema, run: (ctx, a) => runBashTool(ctx, a) },
  { name: 'search', description: 'Hybrid search across all ingested artifacts (vector + BM25, fused via RRF). Optional `path` scopes results to a virtual-filesystem subtree (e.g. `/slack/#pricing`).', schema: searchInputSchema, run: (ctx, a) => runSearchTool(ctx, a) },
  { name: 'list_skills', description: 'List skills available to agents in this organization. Returns name, slug, version, status, and description. Filter by status (default: active).', schema: listSkillsInputSchema, run: (ctx, a) => runListSkillsTool(ctx, a) },
  { name: 'get_skill', description: 'Retrieve the full content of a skill by id or slug. Returns the complete Anthropic Skill format including procedure and examples.', schema: getSkillInputSchema, run: (ctx, a) => runGetSkillTool(ctx, a) },
  { name: 'execute_skill', description: "Execute a skill procedure step-by-step using the skill's written playbook. The skill must have executable=true in its frontmatter. Returns a run ID, per-step LLM responses, and a summary. This tool creates a skill_run record — it is NOT read-only.", schema: executeSkillInputSchema, run: (ctx, a) => runExecuteSkillTool({ ...ctx, anthropicApiKey: ctx.anthropicApiKey }, a) },
  { name: 'get_account_brief', description: 'Pre-call account brief — five-section synthesis (at-a-glance, open issues, last conversation, product asks, context) with citations and per-provider freshness for a given customer account and meeting context. Cached per day; cache hits return `fromCache: true` and a `generated_at` timestamp.', schema: getAccountBriefInputSchema, run: (ctx, a) => runGetAccountBriefTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects, ...(ctx.userId ? { userId: ctx.userId } : {}) }, a) },
  { name: 'submit_feedback', description: 'Record 👍 / 👎 / correction feedback on an assistant turn (RFC-0008). Idempotent on (answer_id, user_id). Feedback can later be promoted into eval entries that gate future regressions.', schema: submitFeedbackInputSchema, run: (ctx, a) => runSubmitFeedbackTool(ctx, a) },
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
