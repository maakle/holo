import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMClient,
  LLMContentBlock,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
} from './index';
import { flattenForAnthropic } from './schema';

/**
 * Anthropic prompt-cache breakpoint. Reads cost 10% of normal input tokens
 * and writes cost 125%; net win as long as the cached prefix is reused at
 * least once within the 5-minute TTL. Critical for the agent loop, which
 * re-sends the entire (system + tools + history) prefix on every iteration.
 */
const CACHE_CONTROL_EPHEMERAL = { type: 'ephemeral' as const };

type CacheControl = typeof CACHE_CONTROL_EPHEMERAL;

type AnthropicContentParam =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; cache_control?: CacheControl };

function toAnthropicContent(content: string | LLMContentBlock[]): string | AnthropicContentParam[] {
  if (typeof content === 'string') return content;
  return content.map((b): AnthropicContentParam => {
    if (b.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        ...(b.isError ? { is_error: true } : {}),
      };
    }
    return b;
  });
}

function toAnthropicMessages(
  messages: LLMMessage[],
): Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentParam[] }> {
  return messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));
}

/**
 * Mark the last message's final content block with a cache breakpoint so
 * the conversation prefix (everything sent in this request) is cached and
 * reused by the next agent-loop iteration. Mutates the last message in
 * place; the array is built fresh in `toAnthropicMessages` each call.
 */
function markLastMessageCached(
  messages: ReturnType<typeof toAnthropicMessages>,
): void {
  if (messages.length === 0) return;
  const last = messages[messages.length - 1]!;
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: CACHE_CONTROL_EPHEMERAL }];
    return;
  }
  if (last.content.length === 0) return;
  const lastBlock = last.content[last.content.length - 1]!;
  lastBlock.cache_control = CACHE_CONTROL_EPHEMERAL;
}

function mapStopReason(raw: string | null | undefined): LLMStopReason {
  switch (raw) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
      return raw;
    default:
      return 'other';
  }
}

export interface AnthropicLLMClientOptions {
  apiKey: string;
  /** Inject a pre-built SDK instance (used in tests). */
  sdk?: Anthropic;
}

export class AnthropicLLMClient implements LLMClient {
  private readonly sdk: Anthropic;

  constructor(opts: AnthropicLLMClientOptions) {
    this.sdk = opts.sdk ?? new Anthropic({ apiKey: opts.apiKey });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const anthropicMessages = toAnthropicMessages(req.messages);
    markLastMessageCached(anthropicMessages);

    const response = await this.sdk.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      // System as an array of text blocks so we can attach cache_control —
      // the Anthropic Messages API accepts string or array form here.
      ...(req.system
        ? {
            system: [
              { type: 'text', text: req.system, cache_control: CACHE_CONTROL_EPHEMERAL },
            ],
          }
        : {}),
      messages: anthropicMessages as never,
      // Cache the LAST tool only — Anthropic caches everything up to the
      // breakpoint, so one mark covers the whole tools array.
      ...(req.tools
        ? {
            tools: req.tools.map((t, i) => ({
              name: t.name,
              description: t.description,
              input_schema: flattenForAnthropic(t.inputSchema),
              ...(i === req.tools!.length - 1
                ? { cache_control: CACHE_CONTROL_EPHEMERAL }
                : {}),
            })) as never,
          }
        : {}),
    });

    const content = response.content
      .filter(
        (b): b is Anthropic.TextBlock | Anthropic.ToolUseBlock =>
          b.type === 'text' || b.type === 'tool_use',
      )
      .map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text };
        return {
          type: 'tool_use' as const,
          id: b.id,
          name: b.name,
          input: (b.input ?? {}) as Record<string, unknown>,
        };
      });

    const usage = response.usage
      ? {
          ...(typeof response.usage.input_tokens === 'number'
            ? { inputTokens: response.usage.input_tokens }
            : {}),
          ...(typeof response.usage.output_tokens === 'number'
            ? { outputTokens: response.usage.output_tokens }
            : {}),
          ...(typeof response.usage.cache_creation_input_tokens === 'number'
            ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens }
            : {}),
          ...(typeof response.usage.cache_read_input_tokens === 'number'
            ? { cacheReadInputTokens: response.usage.cache_read_input_tokens }
            : {}),
        }
      : undefined;

    return {
      stopReason: mapStopReason(response.stop_reason),
      content,
      ...(usage ? { usage } : {}),
    };
  }
}
