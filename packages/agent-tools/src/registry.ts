import { z, type ZodType } from 'zod';
import type { DB } from '@holo/db';
import { listCustomTools, buildCustomToolDefinition } from '@holo/custom-tools';
import { searchInputSchema, runSearchTool } from './tools/search';
import { bashInputSchema, runBashTool, BASH_TOOL_DESCRIPTION } from './tools/bash';
import { getPrInputSchema, runGetPrTool } from './tools/get-pr';
import { getThreadInputSchema, runGetThreadTool } from './tools/get-thread';
import { getDocInputSchema, runGetDocTool } from './tools/get-doc';
import { getCallInputSchema, runGetCallTool } from './tools/get-call';
import { getTicketInputSchema, runGetTicketTool } from './tools/get-ticket';
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
  { name: 'get_pr', description: 'Reassemble a GitHub PR (title + diff + review) by owner/repo/number. DEPRECATED — use `bash` with `cat /github/{owner}/{repo}/pulls/{number}.md` instead.', schema: getPrInputSchema, run: (ctx, a) => runGetPrTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects }, a) },
  { name: 'get_thread', description: 'Fetch a Slack thread by channel and ts. DEPRECATED — use `bash` with `cat /slack/...` instead.', schema: getThreadInputSchema, run: (ctx, a) => runGetThreadTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects }, a) },
  { name: 'get_doc', description: 'Fetch a doc by artifact id, notion page id, or repo+path. DEPRECATED — use `bash` with `cat /notion/...` or `cat /github/...` instead.', schema: getDocInputSchema, run: (ctx, a) => runGetDocTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects }, a) },
  { name: 'get_call', description: 'Fetch a Grain meeting recording (summary + full transcript) by recording_id. DEPRECATED — use `bash` with `cat /grain/...` instead.', schema: getCallInputSchema, run: (ctx, a) => runGetCallTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects }, a) },
  { name: 'get_ticket', description: 'Fetch a Pylon support ticket (conversation history) by ticket_id. DEPRECATED — use `bash` with `cat /pylon/tickets/{id}.md` instead.', schema: getTicketInputSchema, run: (ctx, a) => runGetTicketTool({ db: ctx.db, organizationId: ctx.organizationId, userSubjects: ctx.userSubjects }, a) },
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
