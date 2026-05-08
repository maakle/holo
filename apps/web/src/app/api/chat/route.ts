import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { search } from '@holo/retrieval-core';
import { parseSkill } from '@holo/skills';
import { AnthropicLLMClient, type LLMMessage, type LLMTool } from '@holo/llm';
import { getSubjectsForUser } from '@holo/user-subjects';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export const runtime = 'nodejs';
// The agent loop can take longer than the default serverless slice; raise it
// to match the worker's wall-clock cap.
export const maxDuration = 60;

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});

const bodySchema = z.object({
  messages: z.array(turnSchema).min(1),
  conversationId: z.string().uuid().optional(),
});

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

interface ToolCtx {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: ToolCtx, args: unknown) => Promise<unknown>;
}

const SYSTEM_PROMPT = `You are holo, a knowledge assistant. You have a small set of read-only tools to search and inspect this organization's indexed content and registered skills. Use them to ground your answer; do not speculate.

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

const TOOLS: LocalTool[] = [
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

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId, env } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    if (!env.ANTHROPIC_API_KEY) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured on the server',
        fix: 'Set ANTHROPIC_API_KEY in the web app environment to enable the chat surface.',
      });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid request body',
        fix: 'Send { messages: [{ role, text }] } with at least one message.',
      });
    }

    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const userId = session.user.id;
    const extraSubjects = await getSubjectsForUser(db, userId);
    const ctx: ToolCtx = {
      db,
      organizationId: orgId,
      userSubjects: [`org:${orgId}`, `user:${userId}`, ...extraSubjects],
    };

    let conversationId: string | null = null;
    if (parsed.data.conversationId) {
      const ownedRows = await db
        .select({
          id: schema.chatConversations.id,
          title: schema.chatConversations.title,
        })
        .from(schema.chatConversations)
        .where(
          and(
            eq(schema.chatConversations.id, parsed.data.conversationId),
            eq(schema.chatConversations.organizationId, orgId),
            eq(schema.chatConversations.userId, userId),
          ),
        )
        .limit(1);
      const owned = ownedRows[0];
      if (!owned) {
        return NextResponse.json(
          { code: 'HOLO_NOT_FOUND', problem: 'conversation not found' },
          { status: 404 },
        );
      }
      conversationId = owned.id;
      let lastUserMessage: { role: 'user' | 'assistant'; text: string } | undefined;
      for (let i = parsed.data.messages.length - 1; i >= 0; i--) {
        const m = parsed.data.messages[i]!;
        if (m.role === 'user') {
          lastUserMessage = m;
          break;
        }
      }
      if (lastUserMessage) {
        await db.insert(schema.chatMessages).values({
          conversationId,
          role: 'user',
          text: lastUserMessage.text,
        });
        const titleUpdate: { title?: string; updatedAt: Date } = { updatedAt: new Date() };
        if (owned.title === 'New chat') {
          titleUpdate.title = lastUserMessage.text.slice(0, 80).trim() || 'New chat';
        }
        await db
          .update(schema.chatConversations)
          .set(titleUpdate)
          .where(eq(schema.chatConversations.id, conversationId));
      }
    }

    async function persistAssistant(args: {
      text: string;
      toolCalls: ToolCallTrace[];
      modelCalls: number;
    }) {
      if (!conversationId) return;
      await db.insert(schema.chatMessages).values({
        conversationId,
        role: 'assistant',
        text: args.text,
        toolCalls: args.toolCalls,
        modelCalls: args.modelCalls,
      });
      await db
        .update(schema.chatConversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.chatConversations.id, conversationId));
    }

    const toolByName = new Map<string, LocalTool>(TOOLS.map((t) => [t.name, t]));
    const llmTools: LLMTool[] = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    const client = new AnthropicLLMClient({ apiKey: env.ANTHROPIC_API_KEY });

    const messages: LLMMessage[] = parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    const traces: ToolCallTrace[] = [];
    const maxToolCalls = 12;
    const wallClockMs = 55_000;
    const startedAt = Date.now();
    let toolCallCount = 0;
    let modelCalls = 0;

    while (true) {
      if (Date.now() - startedAt > wallClockMs) {
        await persistAssistant({
          text: `[error] agent exceeded wall clock budget (${wallClockMs}ms)`,
          toolCalls: traces,
          modelCalls,
        });
        return NextResponse.json(
          {
            answer: '',
            toolCalls: traces,
            modelCalls,
            problem: `agent exceeded wall clock budget (${wallClockMs}ms)`,
            code: 'HOLO_AGENT_WALLCLOCK',
          },
          { status: 504 },
        );
      }

      const response = await client.complete({
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
        system: SYSTEM_PROMPT,
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
        await persistAssistant({ text, toolCalls: traces, modelCalls });
        return NextResponse.json({
          answer: text,
          toolCalls: traces,
          modelCalls,
        });
      }

      const toolUses = response.content.filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use',
      );

      const toolResults = [];
      for (const use of toolUses) {
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          await persistAssistant({
            text: `[error] agent exceeded max tool calls (${maxToolCalls})`,
            toolCalls: traces,
            modelCalls,
          });
          return NextResponse.json(
            {
              answer: '',
              toolCalls: traces,
              modelCalls,
              problem: `agent exceeded max tool calls (${maxToolCalls})`,
              code: 'HOLO_AGENT_TOOL_CAP',
            },
            { status: 429 },
          );
        }
        const tool = toolByName.get(use.name);
        const callStart = Date.now();
        if (!tool) {
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output: `tool ${use.name} not registered`,
            isError: true,
            durationMs: Date.now() - callStart,
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
          const output = await tool.run(ctx, use.input);
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output,
            durationMs: Date.now() - callStart,
          };
          traces.push(trace);
          toolResults.push({
            type: 'tool_result' as const,
            toolUseId: use.id,
            content: JSON.stringify(output),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output: `tool error: ${message}`,
            isError: true,
            durationMs: Date.now() - callStart,
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
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : e.code === 'HOLO_ENV_INVALID'
              ? 503
              : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error('[api/chat] unexpected error', e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}
