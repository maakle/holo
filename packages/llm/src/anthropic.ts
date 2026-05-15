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

type AnthropicContentParam =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

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

function toAnthropicMessages(messages: LLMMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  return messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));
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
    const response = await this.sdk.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: toAnthropicMessages(req.messages) as never,
      ...(req.tools
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: flattenForAnthropic(t.inputSchema),
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
