// Shared agent loop core for every chat surface (web, Slack, Google Chat).
//
// Responsibilities:
//   - Call the LLM, append the assistant turn, dispatch tool_use blocks,
//     append tool_result turns, repeat until end_turn / emit_claims / budget
//     cap.
//   - Renumber per-call `search` citations into one monotonic turn-global
//     namespace before they reach the LLM, so `[N]` in the answer resolves
//     unambiguously.
//   - Honor `emit_claims` as a terminal tool (RFC-0007): apply the same
//     server-side downgrade + hard-gate + "couldn't verify" footer the web
//     and Slack surfaces both use.
//   - Emit progress events (`model_start`, `tool_start`, …) so transports
//     can stream live status to the client.
//
// Out of scope (handled by per-surface wrappers):
//   - Source extraction (slack does bash-path + artifact extraction by
//     post-processing the returned trace array).
//   - Transport (NDJSON streaming, Slack mrkdwn rendering, Google Chat cards).
//   - Auth, persistence, tool-list construction.

import type { DB } from '@holo/db';
import type { LLMClient, LLMMessage, LLMStopReason, LLMTool, LLMUsage } from '@holo/llm';
import type { WireCitation } from './citations';
import type { WireSearchCoverage } from './coverage-wire';
import type { WireAnswerClaim } from './claims';
import { claimToWire } from './claims';
import {
  EMIT_CLAIMS_TOOL_DECL,
  appendUnverifiedNoteIfNeeded,
  applyClaimGuardrails,
  parseEmitClaimsInput,
} from './claims-protocol';
import { renumberSearchOutput } from './search-renumber';

export interface AgentLoopToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export interface AgentLoopTool<TCtx extends AgentLoopToolContext = AgentLoopToolContext> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: TCtx, args: unknown) => Promise<unknown>;
}

export interface AgentLoopToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export type AgentLoopEvent =
  | { type: 'model_start'; modelCall: number }
  | {
      type: 'model_end';
      modelCall: number;
      stopReason: LLMStopReason;
      /** Wall-clock duration of just this LLM call. */
      durationMs: number;
      /** Wall-clock elapsed since the start of the whole run. */
      elapsedMs: number;
      usage?: LLMUsage;
    }
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
      /** Echoed from `tool_start` so single-event consumers (audit, progress)
       * don't need to correlate by id. */
      input: Record<string, unknown>;
      output: unknown;
      isError?: boolean;
      durationMs: number;
      /** Wall-clock elapsed since the start of the whole run. */
      elapsedMs: number;
    };

export interface AgentLoopOptions<TCtx extends AgentLoopToolContext> {
  llm: LLMClient;
  model: string;
  /** Full system prompt, including any RFC-0007 claims suffix the caller
   * wants appended. The loop does not modify this string. */
  systemPrompt: string;
  tools: AgentLoopTool<TCtx>[];
  toolCtx: TCtx;
  initialMessages: LLMMessage[];
  maxTokens?: number;
  maxToolCalls?: number;
  wallClockMs?: number;
  /** Override for tests; defaults to Date.now. */
  now?: () => number;
  /** Progress events. Errors thrown by the callback are swallowed so a
   * flaky transport never aborts the agent run. */
  onEvent?: (event: AgentLoopEvent) => void;
}

export type AgentLoopResult =
  | {
      kind: 'answer';
      /** Stable identifier minted at the top of every run. Threaded into
       * feedback payloads (RFC-0008) so a later rating / reaction attributes
       * back to this exact turn. */
      answerId: string;
      answer: string;
      toolCalls: AgentLoopToolCall[];
      modelCalls: number;
      citations: WireCitation[];
      coverage: WireSearchCoverage[];
      /** RFC-0007 structured claims envelope. Empty when the model returned
       * plain text without calling `emit_claims`. */
      claims: WireAnswerClaim[];
    }
  | {
      kind: 'wall_clock_exceeded';
      toolCalls: AgentLoopToolCall[];
      modelCalls: number;
      wallClockMs: number;
    }
  | {
      kind: 'tool_cap_exceeded';
      toolCalls: AgentLoopToolCall[];
      modelCalls: number;
      maxToolCalls: number;
    };

/**
 * Run the agent loop. Pure with respect to transport — no HTTP, no Slack,
 * no Google Chat. Callers provide tools + system prompt and consume the
 * returned discriminated result.
 */
export async function runAgentLoop<TCtx extends AgentLoopToolContext>(
  opts: AgentLoopOptions<TCtx>,
): Promise<AgentLoopResult> {
  const maxToolCalls = opts.maxToolCalls ?? 12;
  const wallClockMs = opts.wallClockMs ?? 55_000;
  const maxTokens = opts.maxTokens ?? 4096;
  const now = opts.now ?? (() => Date.now());
  const emit = (event: AgentLoopEvent) => {
    if (!opts.onEvent) return;
    try {
      opts.onEvent(event);
    } catch {
      // Transport errors must not abort the agent loop.
    }
  };

  const answerId = crypto.randomUUID();

  const toolByName = new Map<string, AgentLoopTool<TCtx>>(
    opts.tools.map((t) => [t.name, t]),
  );
  // `emit_claims` is a terminal "tool" — the model calls it instead of
  // ending the turn with plain text. We advertise it to the LLM but
  // intercept the dispatch below rather than running it through `toolByName`.
  const llmTools: LLMTool[] = [
    ...opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    EMIT_CLAIMS_TOOL_DECL,
  ];

  const messages: LLMMessage[] = [...opts.initialMessages];
  const traces: AgentLoopToolCall[] = [];
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
    const modelStart = now();
    const response = await opts.llm.complete({
      model: opts.model,
      maxTokens,
      system: opts.systemPrompt,
      messages,
      tools: llmTools,
    });
    emit({
      type: 'model_end',
      modelCall: modelCalls,
      stopReason: response.stopReason,
      durationMs: now() - modelStart,
      elapsedMs: now() - startedAt,
      ...(response.usage ? { usage: response.usage } : {}),
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stopReason !== 'tool_use') {
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // Bare end_turn: the model returned text without calling `emit_claims`.
      // RFC-0007 treats this as "no factual claims to verify" — the answer
      // text is still useful; we just have no structured envelope.
      return {
        kind: 'answer',
        answerId,
        answer: text,
        toolCalls: traces,
        modelCalls,
        citations: citationsAcc,
        coverage: coverageAcc,
        claims: [],
      };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    // Terminal `emit_claims`. Honored even if the model calls it alongside
    // other tools in the same turn (a protocol violation, but tolerated): we
    // extract the answer + claims, apply server-side enforcement, and stop.
    const emitClaimsUse = toolUses.find((t) => t.name === EMIT_CLAIMS_TOOL_DECL.name);
    if (emitClaimsUse) {
      const { answerText, claims } = parseEmitClaimsInput(emitClaimsUse.input);
      const enforced = applyClaimGuardrails(claims);
      const finalAnswer = appendUnverifiedNoteIfNeeded(answerText, enforced);
      return {
        kind: 'answer',
        answerId,
        answer: finalAnswer,
        toolCalls: traces,
        modelCalls,
        citations: citationsAcc,
        coverage: coverageAcc,
        claims: enforced.map(claimToWire),
      };
    }

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
      if (now() - startedAt > wallClockMs) {
        return {
          kind: 'wall_clock_exceeded',
          toolCalls: traces,
          modelCalls,
          wallClockMs,
        };
      }
      const tool = toolByName.get(use.name);
      const callStart = now();
      emit({ type: 'tool_start', id: use.id, name: use.name, input: use.input });
      if (!tool) {
        const trace: AgentLoopToolCall = {
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
          input: trace.input,
          output: trace.output,
          isError: true,
          durationMs: trace.durationMs ?? 0,
          elapsedMs: now() - startedAt,
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
          use.name === 'search'
            ? renumberSearchOutput(rawOutput, citationsAcc, coverageAcc)
            : rawOutput;
        const trace: AgentLoopToolCall = {
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
          input: trace.input,
          output: trace.output,
          durationMs: trace.durationMs ?? 0,
          elapsedMs: now() - startedAt,
        });
        toolResults.push({
          type: 'tool_result' as const,
          toolUseId: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const trace: AgentLoopToolCall = {
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
          input: trace.input,
          output: trace.output,
          isError: true,
          durationMs: trace.durationMs ?? 0,
          elapsedMs: now() - startedAt,
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
