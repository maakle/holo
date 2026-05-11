// Chat orchestrator: runs the agent loop (LLM call -> tool dispatch -> repeat)
// for the web chat surface. The web route handler stays as a thin transport
// adapter — request/response shaping, auth, persistence — and delegates the
// loop here so it can be unit-tested with a fake LLM client.
//
// This module is intentionally separate from the broader `listTools` registry
// because the interactive chat surface exposes a slimmer, read-only set
// (search, list_skills, get_skill) with chat-specific input ranges
// (top_k max 20 vs 50, default 8 vs 10). Sharing the registry would silently
// shift those bounds.

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { search } from '@holo/retrieval-core';
import { parseSkill } from '@holo/skills';
import type { LLMClient, LLMMessage, LLMTool } from '@holo/llm';

export interface ChatToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export interface ChatToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export interface ChatLocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: ChatToolContext, args: unknown) => Promise<unknown>;
}

export const CHAT_SYSTEM_PROMPT = `You are holo, a knowledge assistant. You have a small set of read-only tools to search and inspect this organization's indexed content and registered skills. Use them to ground your answer; do not speculate.

Rules:
- Ground every claim in a tool result. Do not invent facts.
- Keep answers concise. Use plain markdown if formatting helps.
- If you cannot find an answer, say so directly.
- This is an interactive web chat used to test the holo agent surface; explaining which tools you used is welcome when relevant.`;

const searchInput = z.object({
  q: z.string().min(1),
  top_k: z.number().int().min(1).max(20).optional().default(8),
  provider: z.enum(['github', 'slack', 'notion', 'grain', 'pylon']).optional(),
});

const listSkillsInput = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional().default('active'),
});

const getSkillInput = z
  .object({
    id: z.string().uuid().optional(),
    slug: z.string().optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((d) => d.id !== undefined || d.slug !== undefined, {
    message: 'Either id or slug must be provided',
  });

export const CHAT_TOOLS: ChatLocalTool[] = [
  {
    name: 'search',
    description:
      'Hybrid search across all ingested artifacts (vector + BM25). Returns top-k chunks with snippet, score, and source metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Natural-language query.' },
        top_k: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 8,
          description: 'Maximum number of results.',
        },
        provider: {
          type: 'string',
          enum: ['github', 'slack', 'notion', 'grain', 'pylon'],
          description: 'Optional provider filter.',
        },
      },
      required: ['q'],
    },
    async run(ctx, raw) {
      const input = searchInput.parse(raw);
      const results = await search({
        db: ctx.db,
        organizationId: ctx.organizationId,
        q: input.q,
        topK: input.top_k,
        provider: input.provider,
        userSubjects: ctx.userSubjects,
      });
      return {
        results: results.map((r) => ({
          chunk_id: r.chunkId,
          score: r.score,
          content: r.content,
          source: {
            provider: r.source.provider,
            artifact_kind: r.source.artifactKind,
            metadata: r.source.metadata,
          },
          ...(r.snippetUrl ? { snippet_url: r.snippetUrl } : {}),
        })),
      };
    },
  },
  {
    name: 'list_skills',
    description:
      'List skills available in this organization. Filter by status (default: active). Returns id, name, slug, version, status, description.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'active', 'archived'],
          default: 'active',
        },
      },
    },
    async run(ctx, raw) {
      const input = listSkillsInput.parse(raw);
      const rows = await ctx.db
        .select({
          id: schema.skills.id,
          name: schema.skills.name,
          slug: schema.skills.slug,
          version: schema.skills.version,
          status: schema.skills.status,
          content: schema.skills.content,
        })
        .from(schema.skills)
        .where(
          and(
            eq(schema.skills.organizationId, ctx.organizationId),
            eq(schema.skills.status, input.status),
          ),
        );

      const skills = [];
      for (const r of rows) {
        try {
          const parsed = parseSkill(r.content);
          skills.push({
            id: r.id,
            name: r.name,
            slug: r.slug,
            version: r.version,
            status: r.status,
            description: parsed.frontmatter.description,
          });
        } catch {
          // Skip rows with malformed YAML — synthesis may produce invalid frontmatter.
        }
      }
      return { skills };
    },
  },
  {
    name: 'get_skill',
    description:
      'Retrieve the full content of a skill by id or slug (optionally pinning version).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
      },
    },
    async run(ctx, raw) {
      const input = getSkillInput.parse(raw);
      const conditions = [eq(schema.skills.organizationId, ctx.organizationId)];
      if (input.id !== undefined) conditions.push(eq(schema.skills.id, input.id));
      if (input.slug !== undefined) conditions.push(eq(schema.skills.slug, input.slug));
      if (input.version !== undefined)
        conditions.push(eq(schema.skills.version, input.version));

      const rows = await ctx.db
        .select({
          id: schema.skills.id,
          name: schema.skills.name,
          slug: schema.skills.slug,
          version: schema.skills.version,
          status: schema.skills.status,
          content: schema.skills.content,
        })
        .from(schema.skills)
        .where(and(...conditions))
        .limit(1);
      const row = rows[0];
      if (!row) return { skill: null };
      return { skill: row };
    },
  },
];

export interface ChatAgentLoopOptions {
  llm: LLMClient;
  model: string;
  toolCtx: ChatToolContext;
  initialMessages: LLMMessage[];
  tools?: ChatLocalTool[];
  maxToolCalls?: number;
  wallClockMs?: number;
  /** Override for tests; defaults to Date.now. */
  now?: () => number;
}

export type ChatAgentLoopResult =
  | {
      kind: 'answer';
      answer: string;
      toolCalls: ChatToolCallTrace[];
      modelCalls: number;
    }
  | {
      kind: 'wall_clock_exceeded';
      toolCalls: ChatToolCallTrace[];
      modelCalls: number;
      wallClockMs: number;
    }
  | {
      kind: 'tool_cap_exceeded';
      toolCalls: ChatToolCallTrace[];
      modelCalls: number;
      maxToolCalls: number;
    };

/**
 * Run the agent loop: call LLM, dispatch tool_use blocks, append tool_result
 * turns, repeat until the LLM returns end_turn (or a budget is exceeded).
 *
 * Pure with respect to transport — no Next.js, no `cookies()`, no `headers()`.
 * The caller handles persistence and response shaping.
 */
export async function runChatAgentLoop(
  opts: ChatAgentLoopOptions,
): Promise<ChatAgentLoopResult> {
  const tools = opts.tools ?? CHAT_TOOLS;
  const maxToolCalls = opts.maxToolCalls ?? 12;
  const wallClockMs = opts.wallClockMs ?? 55_000;
  const now = opts.now ?? (() => Date.now());

  const toolByName = new Map<string, ChatLocalTool>(tools.map((t) => [t.name, t]));
  const llmTools: LLMTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const messages: LLMMessage[] = [...opts.initialMessages];
  const traces: ChatToolCallTrace[] = [];
  const startedAt = now();
  let toolCallCount = 0;
  let modelCalls = 0;

  while (true) {
    if (now() - startedAt > wallClockMs) {
      return {
        kind: 'wall_clock_exceeded',
        toolCalls: traces,
        modelCalls,
        wallClockMs,
      };
    }

    const response = await opts.llm.complete({
      model: opts.model,
      maxTokens: 4096,
      system: CHAT_SYSTEM_PROMPT,
      messages,
      tools: llmTools,
    });
    modelCalls += 1;

    messages.push({ role: 'assistant', content: response.content });

    if (response.stopReason !== 'tool_use') {
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { kind: 'answer', answer: text, toolCalls: traces, modelCalls };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    const toolResults = [];
    for (const use of toolUses) {
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        return {
          kind: 'tool_cap_exceeded',
          toolCalls: traces,
          modelCalls,
          maxToolCalls,
        };
      }
      const tool = toolByName.get(use.name);
      const callStart = now();
      if (!tool) {
        const trace: ChatToolCallTrace = {
          id: use.id,
          name: use.name,
          input: use.input,
          output: `tool ${use.name} not registered`,
          isError: true,
          durationMs: now() - callStart,
        };
        traces.push(trace);
        toolResults.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: trace.output as string,
          isError: true,
        });
        continue;
      }
      try {
        const output = await tool.run(opts.toolCtx, use.input);
        const trace: ChatToolCallTrace = {
          id: use.id,
          name: use.name,
          input: use.input,
          output,
          durationMs: now() - callStart,
        };
        traces.push(trace);
        toolResults.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const trace: ChatToolCallTrace = {
          id: use.id,
          name: use.name,
          input: use.input,
          output: `tool error: ${message}`,
          isError: true,
          durationMs: now() - callStart,
        };
        traces.push(trace);
        toolResults.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: `tool error: ${message}`,
          isError: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
