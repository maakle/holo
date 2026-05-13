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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { searchWithCoverage } from '@holo/retrieval-core';
import { parseSkill } from '@holo/skills';
import type { LLMClient, LLMMessage, LLMStopReason, LLMTool } from '@holo/llm';
import { citationToWire, toCitation, type WireCitation } from './citations';
import { coverageToWire, type WireSearchCoverage } from './coverage-wire';

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

export const CHAT_SYSTEM_PROMPT = `You are holo, a knowledge assistant. You have a small set of read-only tools to search and inspect this organization's indexed content, registered skills, and configured connections. Use them to ground your answer; do not speculate.

Rules:
- Ground every claim in a tool result. Do not invent facts.
- Cite your sources. Each \`search\` tool result includes a \`citations\` array with 1-based \`index\` values. When you state a fact grounded in one of those results, append the matching bracket reference like \`[1]\` (or \`[2][3]\` for multiple). Do not invent indices and do not cite results you didn't use.
- For questions about which sources / connectors / integrations are connected, call list_connections — never infer connections from search results, that misses providers whose content hasn't matched a query.
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
      const { results, coverage } = await searchWithCoverage({
        db: ctx.db,
        organizationId: ctx.organizationId,
        q: input.q,
        topK: input.top_k,
        provider: input.provider,
        userSubjects: ctx.userSubjects,
      });
      // Per-call 1-based indices. The orchestrator renumbers them across
      // multiple search calls in one turn so the model sees a single
      // monotonic citation namespace and doesn't double-cite [1].
      const citations = results.map((r, i) => citationToWire(toCitation(r, i + 1)));
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
        citations,
        coverage: coverageToWire(coverage),
      };
    },
  },
  {
    name: 'list_connections',
    description:
      'List every provider with at least one configured source in this organization, with per-provider source count and last sync time. Use this for any question about which sources / connectors / integrations are connected — search results only cover providers whose content matched a query and will under-report.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async run(ctx) {
      const sourceRows = await ctx.db
        .select({
          provider: schema.sources.provider,
          id: schema.sources.id,
          name: schema.sources.name,
        })
        .from(schema.sources)
        .where(eq(schema.sources.organizationId, ctx.organizationId));

      if (sourceRows.length === 0) {
        return { connections: [] };
      }

      const sourceIds = sourceRows.map((s) => s.id);
      const cursorRows = await ctx.db
        .select({
          sourceId: schema.connectorCursors.sourceId,
          lastRunAt: schema.connectorCursors.lastRunAt,
          lastStatus: schema.connectorCursors.lastStatus,
        })
        .from(schema.connectorCursors)
        .where(
          and(
            eq(schema.connectorCursors.organizationId, ctx.organizationId),
            inArray(schema.connectorCursors.sourceId, sourceIds),
          ),
        );
      const cursorBySource = new Map(
        cursorRows.map((c) => [c.sourceId, c]),
      );

      const chunkCounts = await ctx.db
        .select({
          provider: schema.chunks.provider,
          c: sql<number>`count(*)::int`,
        })
        .from(schema.chunks)
        .where(eq(schema.chunks.organizationId, ctx.organizationId))
        .groupBy(schema.chunks.provider);
      const chunksByProvider = new Map<string, number>(
        chunkCounts.map((r) => [r.provider, r.c]),
      );

      const byProvider = new Map<
        string,
        {
          provider: string;
          source_count: number;
          last_synced_at: string | null;
          last_status: string | null;
          chunks_indexed: number;
          source_names: string[];
        }
      >();
      for (const s of sourceRows) {
        const entry = byProvider.get(s.provider) ?? {
          provider: s.provider,
          source_count: 0,
          last_synced_at: null as string | null,
          last_status: null as string | null,
          chunks_indexed: chunksByProvider.get(s.provider) ?? 0,
          source_names: [] as string[],
        };
        entry.source_count += 1;
        entry.source_names.push(s.name);
        const cursor = cursorBySource.get(s.id);
        if (cursor?.lastRunAt) {
          const iso = cursor.lastRunAt.toISOString();
          if (!entry.last_synced_at || iso > entry.last_synced_at) {
            entry.last_synced_at = iso;
            entry.last_status = cursor.lastStatus;
          }
        }
        byProvider.set(s.provider, entry);
      }

      // Cap names per provider so the tool result stays small for chatty orgs.
      const connections = [...byProvider.values()]
        .map((c) => ({
          ...c,
          source_names: c.source_names.slice(0, 10),
          source_names_truncated: c.source_names.length > 10,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider));
      return { connections };
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

export type ChatAgentEvent =
  | { type: 'model_start'; modelCall: number }
  | { type: 'model_end'; modelCall: number; stopReason: LLMStopReason }
  | {
      type: 'tool_start';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      output: unknown;
      isError?: boolean;
      durationMs: number;
    };

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
  /**
   * Fired as the loop progresses (model call boundaries, tool start/end).
   * Used by the web transport to stream live status to the client. Errors
   * thrown by the callback are swallowed so a flaky transport never aborts
   * the agent run.
   */
  onEvent?: (event: ChatAgentEvent) => void;
}

export type ChatAgentLoopResult =
  | {
      kind: 'answer';
      answer: string;
      toolCalls: ChatToolCallTrace[];
      modelCalls: number;
      /** Renumbered citations across every `search` tool call in the turn,
       * 1-based and monotonic. The model is told to reference them as
       * `[1]`, `[2]`, ... in the answer text. Wire (snake_case) shape so
       * the field is the same one the model saw in the tool output and the
       * REST surface returns. */
      citations: WireCitation[];
      /** Coverage payloads from every `search` tool call in the turn, in
       * call order. Surface as a "what I searched" footer in the UI. */
      coverage: WireSearchCoverage[];
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
  const emit = (event: ChatAgentEvent) => {
    if (!opts.onEvent) return;
    try {
      opts.onEvent(event);
    } catch {
      // Transport errors must not abort the agent loop.
    }
  };

  const toolByName = new Map<string, ChatLocalTool>(tools.map((t) => [t.name, t]));
  const llmTools: LLMTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const messages: LLMMessage[] = [...opts.initialMessages];
  const traces: ChatToolCallTrace[] = [];
  // Citations across every `search` tool call in the turn, renumbered to a
  // single monotonic namespace before being shipped to the LLM. The model
  // references them as [1], [2], ... in the answer text.
  const citationsAcc: WireCitation[] = [];
  const coverageAcc: WireSearchCoverage[] = [];
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

    modelCalls += 1;
    emit({ type: 'model_start', modelCall: modelCalls });
    const response = await opts.llm.complete({
      model: opts.model,
      maxTokens: 4096,
      system: CHAT_SYSTEM_PROMPT,
      messages,
      tools: llmTools,
    });
    emit({ type: 'model_end', modelCall: modelCalls, stopReason: response.stopReason });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stopReason !== 'tool_use') {
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return {
        kind: 'answer',
        answer: text,
        toolCalls: traces,
        modelCalls,
        citations: citationsAcc,
        coverage: coverageAcc,
      };
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
      emit({ type: 'tool_start', id: use.id, name: use.name, input: use.input });
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
        emit({
          type: 'tool_end',
          id: trace.id,
          name: trace.name,
          output: trace.output,
          isError: true,
          durationMs: trace.durationMs ?? 0,
        });
        toolResults.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: trace.output as string,
          isError: true,
        });
        continue;
      }
      try {
        const rawOutput = await tool.run(opts.toolCtx, use.input);
        // For `search` tool calls, renumber the per-call citation indices
        // into the turn-global namespace before the output reaches both the
        // LLM (via JSON.stringify) and the trace consumer. This is the only
        // tool-name special-case in the loop; it lives here rather than in
        // the tool because the tool has no view of prior calls in the turn.
        const output =
          use.name === 'search' ? renumberSearchOutput(rawOutput, citationsAcc, coverageAcc) : rawOutput;
        const trace: ChatToolCallTrace = {
          id: use.id,
          name: use.name,
          input: use.input,
          output,
          durationMs: now() - callStart,
        };
        traces.push(trace);
        emit({
          type: 'tool_end',
          id: trace.id,
          name: trace.name,
          output: trace.output,
          durationMs: trace.durationMs ?? 0,
        });
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
        emit({
          type: 'tool_end',
          id: trace.id,
          name: trace.name,
          output: trace.output,
          isError: true,
          durationMs: trace.durationMs ?? 0,
        });
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

/**
 * Rewrite the `citations[].index` field on a `search` tool's output so the
 * indices count up from where the prior search call left off. Mutates the
 * returned object's citations array but leaves everything else alone, and
 * appends the (renumbered) citations + raw coverage to the loop's
 * accumulators so the final `answer` result can carry them through to the
 * caller / UI.
 *
 * Defensive against malformed tool outputs: if the shape doesn't match
 * (e.g. a test stub returned something else under the `search` name), we
 * pass the value through untouched. The orchestrator's contract is to not
 * crash on tool output shape — only the tool itself owns that schema.
 */
function renumberSearchOutput(
  rawOutput: unknown,
  citationsAcc: WireCitation[],
  coverageAcc: WireSearchCoverage[],
): unknown {
  if (!rawOutput || typeof rawOutput !== 'object') return rawOutput;
  const out = rawOutput as { citations?: unknown; coverage?: unknown };
  if (out.coverage && typeof out.coverage === 'object') {
    coverageAcc.push(out.coverage as WireSearchCoverage);
  }
  if (!Array.isArray(out.citations)) return rawOutput;
  const offset = citationsAcc.length;
  const renumbered = out.citations.map((c, i) => {
    const cit = c as WireCitation;
    const renumberedCit: WireCitation = { ...cit, index: offset + i + 1 };
    citationsAcc.push(renumberedCit);
    return renumberedCit;
  });
  return { ...out, citations: renumbered };
}
