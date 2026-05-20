// Vercel AI SDK adapter for `LLMClient`. Calls `generateText` from `ai` with
// the `@ai-sdk/anthropic` provider, returning after a single model step so
// the orchestrator (which owns tool dispatch, citation renumbering, claim
// enforcement) stays in control of the loop. We deliberately do NOT pass
// `execute` on the tool defs — that's what makes the SDK stop after one
// round-trip instead of looping internally.

import { generateText, jsonSchema, stepCountIs, tool as defineTool } from 'ai';
import type { ModelMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  LLMClient,
  LLMContentBlock,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
} from './index';
import { flattenForAnthropic } from './schema';

type AnthropicProvider = ReturnType<typeof createAnthropic>;

/**
 * Anthropic prompt-cache breakpoint. Reads cost 10% of normal input tokens
 * and writes cost 125%; net win as long as the cached prefix is reused at
 * least once within the 5-minute TTL. Critical here because the agent loop
 * re-sends the entire (system + tools + history) prefix on every iteration.
 */
const CACHE_CONTROL_EPHEMERAL = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

export interface VercelAILLMClientOptions {
  apiKey: string;
  /** Inject a pre-built provider instance (used in tests with a stub fetch). */
  provider?: AnthropicProvider;
}

function mapFinishReason(reason: string | null | undefined): LLMStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool-calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'other';
  }
}

/**
 * Convert our `LLMMessage[]` into the AI SDK's `ModelMessage[]`. Two shape
 * differences worth calling out:
 *   - Tool results live on `role: 'tool'` messages in AI SDK; in our shape
 *     they ride along on `role: 'user'`. We split them out.
 *   - Assistant tool-use blocks need `type: 'tool-call'` (hyphen) in AI SDK
 *     vs `type: 'tool_use'` (underscore) in our shape.
 */
function toModelMessages(messages: LLMMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const parts = m.content
        .map((b) => {
          if (b.type === 'text') return { type: 'text' as const, text: b.text };
          if (b.type === 'tool_use')
            return {
              type: 'tool-call' as const,
              toolCallId: b.id,
              toolName: b.name,
              input: b.input,
            };
          return null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
      out.push({ role: 'assistant', content: parts });
      continue;
    }
    const toolResults = m.content.filter(
      (b): b is Extract<LLMContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
    );
    const textParts = m.content.filter(
      (b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text',
    );
    if (textParts.length > 0) {
      out.push({
        role: 'user',
        content: textParts.map((t) => ({ type: 'text' as const, text: t.text })),
      });
    }
    if (toolResults.length > 0) {
      out.push({
        role: 'tool',
        content: toolResults.map((tr) => ({
          type: 'tool-result' as const,
          toolCallId: tr.toolUseId,
          toolName: 'tool',
          output: tr.isError
            ? { type: 'error-text' as const, value: tr.content }
            : { type: 'text' as const, value: tr.content },
        })),
      });
    }
  }
  return out;
}

export class VercelAILLMClient implements LLMClient {
  private readonly provider: AnthropicProvider;

  constructor(opts: VercelAILLMClientOptions) {
    this.provider = opts.provider ?? createAnthropic({ apiKey: opts.apiKey });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    // Cache the LAST tool only — Anthropic caches everything up to a
    // breakpoint, so one mark covers the whole tools array. Reused on every
    // agent-loop iteration as long as the tool list is stable (it is).
    const tools = req.tools
      ? Object.fromEntries(
          req.tools.map((t, i) => [
            t.name,
            defineTool({
              description: t.description,
              inputSchema: jsonSchema(flattenForAnthropic(t.inputSchema) as never),
              ...(i === req.tools!.length - 1
                ? { providerOptions: CACHE_CONTROL_EPHEMERAL }
                : {}),
            }),
          ]),
        )
      : undefined;

    // Cache the conversation prefix by marking the last message. Each
    // agent-loop iteration adds one more turn, so this breakpoint advances
    // and the prior prefix gets a cache hit on the next call.
    const modelMessages = toModelMessages(req.messages);
    if (modelMessages.length > 0) {
      const last = modelMessages[modelMessages.length - 1]!;
      modelMessages[modelMessages.length - 1] = {
        ...last,
        providerOptions: CACHE_CONTROL_EPHEMERAL,
      } as ModelMessage;
    }

    // Pass system as a SystemModelMessage so we can attach cacheControl.
    // The AI SDK serializes this to the same Anthropic `system` array
    // format the top-level `system: string` shortcut produces, just with
    // a cache_control entry on the block.
    const messages: ModelMessage[] = req.system
      ? [
          {
            role: 'system',
            content: req.system,
            providerOptions: CACHE_CONTROL_EPHEMERAL,
          },
          ...modelMessages,
        ]
      : modelMessages;

    const result = await generateText({
      model: this.provider(req.model),
      messages,
      maxOutputTokens: req.maxTokens,
      ...(tools ? { tools } : {}),
      // Single round-trip: the orchestrator runs the tool loop, not the SDK.
      stopWhen: stepCountIs(1),
      // We move the system prompt into `messages` so we can attach
      // cacheControl to it. The system prompt is server-built (never user
      // content), so the AI SDK's prompt-injection warning doesn't apply.
      allowSystemInMessages: true,
    } as Parameters<typeof generateText>[0] & { allowSystemInMessages?: boolean });

    const content: LLMResponse['content'] = [];
    for (const part of result.content) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        content.push({
          type: 'tool_use',
          id: part.toolCallId,
          name: part.toolName,
          input: (part.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    const u = result.usage;
    const usage = u
      ? {
          ...(typeof u.inputTokens === 'number' ? { inputTokens: u.inputTokens } : {}),
          ...(typeof u.outputTokens === 'number' ? { outputTokens: u.outputTokens } : {}),
          ...(typeof u.inputTokenDetails?.cacheReadTokens === 'number'
            ? { cacheReadInputTokens: u.inputTokenDetails.cacheReadTokens }
            : {}),
          ...(typeof u.inputTokenDetails?.cacheWriteTokens === 'number'
            ? { cacheCreationInputTokens: u.inputTokenDetails.cacheWriteTokens }
            : {}),
        }
      : undefined;

    return {
      stopReason: mapFinishReason(result.finishReason),
      content,
      ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
    };
  }
}
