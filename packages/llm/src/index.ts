// Provider-neutral LLM seam. Two adapters today:
//   - AnthropicLLMClient — calls @anthropic-ai/sdk directly; used by the
//     worker (Slack bot, Google Chat bot) and by background utilities.
//   - VercelAILLMClient — calls @ai-sdk/anthropic via the `ai` package's
//     `generateText`; used by the Next.js web chat route. Both target the
//     same Anthropic Messages API; the seam swaps cleanly because we keep
//     tool dispatch in the orchestrator and force a single round-trip
//     (`stopWhen: stepCountIs(1)`).
//
// All agent surfaces (web, Slack, Google Chat) run the shared loop in
// @holo/agent-tools/agent-loop. The seam below is what they consume.

export type LLMRole = 'user' | 'assistant';

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LLMMessage {
  role: LLMRole;
  /** String for plain text turns; array for tool-use / tool-result turns. */
  content: string | LLMContentBlock[];
}

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

export interface LLMRequest {
  /** Provider-specific model id. Adapters pass it through unchanged. */
  model: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens: number;
  tools?: LLMTool[];
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Anthropic-specific. Surfaced by both adapters when the provider returns
   * it; falls back to undefined when the SDK doesn't expose it. */
  cacheCreationInputTokens?: number;
  /** Anthropic-specific. See `cacheCreationInputTokens`. */
  cacheReadInputTokens?: number;
}

export interface LLMResponse {
  stopReason: LLMStopReason;
  /** Only `text` and `tool_use` blocks appear here (never `tool_result`). */
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  /** Token + cache accounting. Best-effort across adapters. */
  usage?: LLMUsage;
}

export interface LLMClient {
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export { AnthropicLLMClient } from './anthropic';
export { VercelAILLMClient } from './vercel';
export { flattenForAnthropic } from './schema';
export {
  resolveAnthropicAgentModel,
  resolveAnthropicUtilityModel,
} from './anthropic-models';
