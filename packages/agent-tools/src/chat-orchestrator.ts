// Chat orchestrator: web-chat-specific tool list + system prompt on top of
// the shared agent loop in `agent-loop.ts`. The web route handler stays as
// a thin transport adapter — request/response shaping, auth, persistence —
// and delegates the loop here so it can be unit-tested with a fake LLM
// client.
//
// This module is intentionally separate from the broader `listTools`
// registry because the interactive chat surface exposes a slimmer,
// read-only set (search, list_connections, list_skills, get_skill) with
// chat-specific input ranges (top_k max 20 vs 50, default 8 vs 10).
// Sharing the registry would silently shift those bounds.

import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { searchWithCoverage } from '@holo/retrieval-core';
import { parseSkill } from '@holo/skills';
import type { LLMClient, LLMMessage } from '@holo/llm';
import { citationToWire, toCitation, type WireCitation } from './citations';
import { coverageToWire, type WireSearchCoverage } from './coverage-wire';
import { type WireAnswerClaim } from './claims';
import { CLAIMS_SUFFIX } from './claims-protocol';
import { runAgentLoop, type AgentLoopEvent } from './agent-loop';

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

/**
 * Backwards-compat re-export. `CLAIMS_SUFFIX` lives in `claims-protocol.ts`
 * so the slack bot can use the same wording; this alias keeps anything that
 * imported `CHAT_CLAIMS_SUFFIX` working.
 */
export { CLAIMS_SUFFIX as CHAT_CLAIMS_SUFFIX } from './claims-protocol';

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

/**
 * Event shape emitted by the agent loop. Re-exported here as
 * `ChatAgentEvent` so older imports keep compiling; structurally identical
 * to `AgentLoopEvent` from `./agent-loop`.
 */
export type ChatAgentEvent = AgentLoopEvent;

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
      /** Stable identifier for this assistant turn. Minted at the start of
       * the loop and surfaced to the client so it can attach feedback
       * (`POST /v1/feedback { answer_id, rating, correction_text? }`) without
       * a separate lookup. NOT a database row id — the orchestrator does not
       * persist; the chat route handler may store it alongside the turn if
       * desired, but the contract here is "this string identifies this
       * answer for the lifetime of the client's session." Wire is
       * snake_case (`answer_id`); this in-process result uses camelCase to
       * match the rest of the result envelope. */
      answerId: string;
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
      /** Structured claims envelope (RFC-0007). Always present — every
       * answer goes through the `emit_claims` protocol and the server-side
       * downgrade + hard-gate. An empty array means the model returned no
       * factual claims (e.g. conversational filler). */
      claims: WireAnswerClaim[];
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
 * The caller handles persistence and response shaping. The loop body itself
 * lives in `runAgentLoop` (`./agent-loop`); this wrapper just supplies the
 * web-chat tool list, system prompt, and budget defaults.
 */
export async function runChatAgentLoop(
  opts: ChatAgentLoopOptions,
): Promise<ChatAgentLoopResult> {
  const tools = opts.tools ?? CHAT_TOOLS;
  return runAgentLoop<ChatToolContext>({
    llm: opts.llm,
    model: opts.model,
    systemPrompt: `${CHAT_SYSTEM_PROMPT}${CLAIMS_SUFFIX}`,
    tools,
    toolCtx: opts.toolCtx,
    initialMessages: opts.initialMessages,
    maxTokens: 4096,
    maxToolCalls: opts.maxToolCalls ?? 12,
    wallClockMs: opts.wallClockMs ?? 55_000,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  });
}

