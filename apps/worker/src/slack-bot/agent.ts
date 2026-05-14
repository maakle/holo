import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { DB } from '@holo/db';
import type {
  ToolDefinition,
  WireAnswerClaim,
  WireCitation,
  WireSearchCoverage,
} from '@holo/agent-tools';
import {
  CLAIMS_SUFFIX,
  EMIT_CLAIMS_TOOL_DECL,
  appendUnverifiedNoteIfNeeded,
  applyClaimGuardrails,
  claimToWire,
  parseEmitClaimsInput,
  renumberSearchOutput,
} from '@holo/agent-tools';
import { resolveAnthropicAgentModel } from '@holo/llm';

export interface Source {
  provider: string;
  kind: string;
  title: string;
  /**
   * Deep link to the source artifact. Undefined when the provider doesn't
   * have a stable URL pattern yet (e.g. Salesforce, HubSpot today). The
   * Slack renderer falls back to label-only when this is missing.
   */
  url?: string;
}

export interface AgentResult {
  /**
   * Stable identifier minted at the top of every `runAgent`. Threaded into
   * the slack reply via `slack_answer_index` (RFC-0008 extension) so a
   * subsequent reaction_added webhook can attribute feedback back to the
   * exact orchestrator turn that produced the answer.
   */
  answerId: string;
  answer: string;
  sources: Source[];
  /**
   * Structured claims envelope (RFC-0007). Empty when the model returned
   * plain text without calling `emit_claims` (e.g. a conversational reply
   * with no factual claims). The slack reply text already carries an
   * appended "Note: I couldn't verify N claims" footer when any claim
   * was hard-gated to `unverified`, so slack callers don't need to render
   * `claims` — but the structured envelope is here for completeness and
   * for feedback-loop persistence (RFC-0008).
   */
  claims: WireAnswerClaim[];
}

export interface RunAgentDeps {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  question: string;
  /** Injected for tests. In production, instantiate per call from env. */
  client: Anthropic;
  /** Injected for tests. In production, call listTools() from @holo/agent-tools. */
  tools: ToolDefinition[];
  /** Org display name for the system prompt. */
  orgName: string;
  /** Defaults to 20. */
  maxToolCalls?: number;
  /** Defaults to 60_000 ms. */
  wallClockMs?: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
  /** Optional trace callback; receives one event per model call and per tool call. */
  logEvent?: (event: 'model_call' | 'tool_call' | 'tool_error', fields: Record<string, unknown>) => void;
}

export class AgentRunawayError extends Error {
  constructor(public reason: 'tool_call_cap' | 'wall_clock_cap', message: string) {
    super(message);
    this.name = 'AgentRunawayError';
  }
}

const SYSTEM_PROMPT_TEMPLATE = `You are holo, a knowledge assistant for {org_name}. You have tools to search and fetch content from this organization's connected sources and to call any custom tools the organization has registered. Call whichever tools you need to answer the user's question — do not assume which sources are available; let the tool list and tool results tell you.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Cite your sources. Each \`search\` tool result includes a \`citations\` array with 1-based \`index\` values. When you state a fact grounded in one of those results, append the matching bracket reference like \`[1]\` (or \`[2][3]\` for multiple). Do not invent indices and do not cite results you didn't use.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack mrkdwn), not markdown headers (#) or fenced code blocks unless quoting code. Bullets with \`- \` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.`;

type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type Message = { role: 'user' | 'assistant'; content: unknown };

const META_TOOLS = new Set(['list_skills', 'get_skill', 'execute_skill']);

/**
 * Convert a renumbered citation envelope into the `Source` shape the Slack
 * renderer consumes. Position N-1 in the returned array corresponds to the
 * `[N]` reference the model is told to emit in the answer text.
 */
function citationToSource(c: WireCitation): Source {
  return {
    provider: c.provider,
    kind: c.artifact_kind,
    title: c.label,
    ...(c.url !== undefined ? { url: c.url } : {}),
  };
}

/**
 * Best-effort source from a non-search artifact tool. Today this only fires
 * for custom tools that emit a `url` field on their output (built-in tools
 * other than `search` no longer surface citations this way; bash returns
 * raw stdout/stderr without a URL). These don't participate in the citation
 * namespace — they get appended after the numbered citations as
 * supplementary entries the model can describe but not `[N]`-reference.
 */
function artifactToSource(toolName: string, output: unknown): Source | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const o = output as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url : undefined;
  if (!url) return undefined;
  const provider = typeof o.provider === 'string' ? o.provider : toolName;
  const kind = typeof o.kind === 'string' ? o.kind : 'artifact';
  const title = typeof o.title === 'string' ? o.title : `${provider} · ${kind}`;
  return { provider, kind, title, url };
}

// Anthropic's tool API requires `type: "object"` at the root of input_schema
// AND rejects `anyOf`/`oneOf`/`allOf` at the top level. Zod's z.toJSONSchema
// emits exactly those for unions and refined objects (e.g. get_skill, or
// custom tools). Flatten the branches into a merged `properties` map; the
// tool runner still validates via the original zod schema at runtime.
function toAnthropicInputSchema(raw: unknown): Record<string, unknown> {
  const schema = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const branches =
    (schema['anyOf'] as unknown) ??
    (schema['oneOf'] as unknown) ??
    (schema['allOf'] as unknown);

  if (Array.isArray(branches)) {
    const properties: Record<string, unknown> = {};
    for (const branch of branches) {
      if (branch && typeof branch === 'object') {
        const branchProps = (branch as { properties?: Record<string, unknown> }).properties;
        if (branchProps) Object.assign(properties, branchProps);
      }
    }
    const { anyOf: _a, oneOf: _o, allOf: _al, type: _t, properties: _p, ...rest } = schema;
    return { ...rest, type: 'object', properties };
  }

  if (schema['type'] === 'object') return schema;
  return { type: 'object', ...schema };
}

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  // RFC-0008: stable id minted at the top of every run so a slack reply can
  // be indexed in `slack_answer_index` and a reaction_added event later can
  // attribute feedback back to this exact turn.
  const answerId = randomUUID();
  // RFC-0007: the slack bot uses the same claims protocol as the web chat.
  // Slack can't render confidence chips, so the user-visible signal is the
  // "Note: I couldn't verify N claims" footer that `appendUnverifiedNoteIfNeeded`
  // tacks onto the answer text below — same wording the REST surface uses.
  const system = `${SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName)}${CLAIMS_SUFFIX}`;
  const anthropicTools: AnthropicTool[] = [
    ...deps.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toAnthropicInputSchema(t.inputSchema),
    })),
    {
      name: EMIT_CLAIMS_TOOL_DECL.name,
      description: EMIT_CLAIMS_TOOL_DECL.description,
      input_schema: toAnthropicInputSchema(EMIT_CLAIMS_TOOL_DECL.inputSchema),
    },
  ];
  const toolByName = new Map(deps.tools.map((t) => [t.name, t]));

  const ctx = {
    db: deps.db,
    organizationId: deps.organizationId,
    userSubjects: deps.userSubjects,
  };

  const messages: Message[] = [{ role: 'user', content: deps.question }];
  const maxToolCalls = deps.maxToolCalls ?? 20;
  let toolCallCount = 0;
  const wallClockMs = deps.wallClockMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  // Citation accumulator — every `search` tool result gets renumbered into
  // this monotonic 1..N namespace before reaching the model, so `[N]` in the
  // final answer text resolves unambiguously to `citationsAcc[N-1]`.
  const citationsAcc: WireCitation[] = [];
  const coverageAcc: WireSearchCoverage[] = [];
  // Supplementary sources from non-search tools (custom tools that emit a
  // `url` on their output). Not part of the citation namespace; appended
  // after the numbered list.
  const artifactSources: Source[] = [];
  const logEvent = deps.logEvent ?? (() => {});
  let modelCallCount = 0;

  const buildSources = (): Source[] => [
    ...citationsAcc.map(citationToSource),
    ...artifactSources,
  ];

  while (true) {
    if (now() - startedAt > wallClockMs) {
      throw new AgentRunawayError(
        'wall_clock_cap',
        `agent exceeded wall clock budget (${wallClockMs}ms)`,
      );
    }
    const modelStart = now();
    const model = resolveAnthropicAgentModel();
    const response = (await deps.client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [...messages] as never,
      tools: anthropicTools as never,
    })) as {
      stop_reason: string;
      content: ContentBlock[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    modelCallCount += 1;
    logEvent('model_call', {
      callIndex: modelCallCount,
      model,
      durationMs: now() - modelStart,
      stopReason: response.stop_reason,
      elapsedMs: now() - startedAt,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') {
        console.warn(
          `[runAgent] response truncated by max_tokens for org=${deps.organizationId}`,
        );
      }
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // Bare end_turn fallback (no `emit_claims` call). The answer is still
      // useful; we just have no structured claims to enforce. Return an
      // empty `claims` array — slack reply renders normally without the
      // "couldn't verify" footer.
      return { answerId, answer: text, sources: buildSources(), claims: [] };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    // Terminal `emit_claims` (RFC-0007). The model calls this instead of
    // ending with plain text; we apply the same server-side downgrade +
    // hard-gate as the web orchestrator and append a "couldn't verify"
    // footer to the answer text when any claim ended up `unverified`.
    const emitClaimsUse = toolUses.find((t) => t.name === EMIT_CLAIMS_TOOL_DECL.name);
    if (emitClaimsUse) {
      const { answerText, claims: rawClaims } = parseEmitClaimsInput(emitClaimsUse.input);
      const enforced = applyClaimGuardrails(rawClaims);
      const finalAnswer = appendUnverifiedNoteIfNeeded(answerText, enforced);
      return {
        answerId,
        answer: finalAnswer,
        sources: buildSources(),
        claims: enforced.map(claimToWire),
      };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        throw new AgentRunawayError(
          'tool_call_cap',
          `agent exceeded max tool calls (${maxToolCalls})`,
        );
      }
      if (now() - startedAt > wallClockMs) {
        throw new AgentRunawayError(
          'wall_clock_cap',
          `agent exceeded wall clock budget (${wallClockMs}ms)`,
        );
      }
      const tool = toolByName.get(use.name);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool ${use.name} not registered`,
          is_error: true,
        });
        continue;
      }
      const toolStart = now();
      try {
        const rawOutput = await tool.run(ctx, use.input);
        // For `search` tool calls, renumber the per-call citation indices
        // into the turn-global namespace before the output reaches both the
        // model (via JSON.stringify) and the source list. Mirrors the web
        // orchestrator so `[N]` semantics are identical across surfaces.
        const output =
          use.name === 'search'
            ? renumberSearchOutput(rawOutput, citationsAcc, coverageAcc)
            : rawOutput;
        logEvent('tool_call', {
          tool: use.name,
          input: use.input,
          output,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
        });
        if (use.name !== 'search' && !META_TOOLS.has(use.name)) {
          const src = artifactToSource(use.name, output);
          if (src) artifactSources.push(src);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logEvent('tool_error', {
          tool: use.name,
          input: use.input,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
          error: message,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool error: ${message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
