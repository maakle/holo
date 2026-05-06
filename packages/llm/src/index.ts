// Provider-neutral LLM seam. Today only Anthropic is wired up; the shape is
// chosen to map 1:1 to Vercel AI SDK's `generateText` (text, tool calls,
// finishReason) so swapping later is mechanical.
//
// Migration status:
// - packages/discovery/src/propose.ts → uses LLMClient
// - packages/skills/src/executor.ts → uses LLMClient
// - apps/worker/src/slack-bot/agent.ts → still on raw Anthropic SDK. The
//   agent loop builds tool_result blocks turn-by-turn; porting it means
//   rewriting tests too. Do that when a second provider is actually needed.

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

export interface LLMResponse {
  stopReason: LLMStopReason;
  /** Only `text` and `tool_use` blocks appear here (never `tool_result`). */
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
}

export interface LLMClient {
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export { AnthropicLLMClient } from './anthropic.js';
