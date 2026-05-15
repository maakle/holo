import { describe, it, expect } from 'vitest';
import { VercelAILLMClient } from '../src/vercel';

// The Vercel AI SDK adapter goes through `@ai-sdk/anthropic`, which talks
// to api.anthropic.com via fetch. We stub that fetch so the test exercises
// the adapter's request-build + response-parse paths without a real network
// call. The shape mirrors what the Anthropic Messages API returns.

interface AnthropicMessagesResponseShape {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: string; [k: string]: unknown }>;
  stop_reason: string;
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function jsonResponse(body: AnthropicMessagesResponseShape): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VercelAILLMClient', () => {
  it('maps a plain end_turn response to LLMResponse with text + usage', async () => {
    let sentBody: unknown;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'hello back' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 4 },
      });
    };

    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const provider = createAnthropic({
      apiKey: 'sk-test',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const client = new VercelAILLMClient({ apiKey: 'sk-test', provider });

    const result = await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      system: 'be helpful',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'hello back' }]);
    expect(result.usage?.inputTokens).toBe(12);
    expect(result.usage?.outputTokens).toBe(4);

    // The request body should include our system prompt and a user turn.
    expect(sentBody).toMatchObject({
      system: expect.any(Array),
      messages: [{ role: 'user', content: expect.any(Array) }],
    });
  });

  it('maps a tool-use response to a tool_use content block', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [
          { type: 'text', text: 'looking up…' },
          { type: 'tool_use', id: 'tu_42', name: 'search', input: { q: 'deploy' } },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
      });

    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const provider = createAnthropic({
      apiKey: 'sk-test',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const client = new VercelAILLMClient({ apiKey: 'sk-test', provider });

    const result = await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'how do we deploy?' }],
      tools: [
        {
          name: 'search',
          description: 'search',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'text', text: 'looking up…' },
      { type: 'tool_use', id: 'tu_42', name: 'search', input: { q: 'deploy' } },
    ]);
  });

  it('round-trips a tool_result turn back into the Anthropic message shape', async () => {
    // The shared agent loop pushes tool_result blocks under a `role: 'user'`
    // message in our LLMMessage shape. The AI SDK expects them under a
    // `role: 'tool'` ModelMessage. Verify the adapter splits them out so the
    // outbound request is well-formed.
    let sentBody: { messages: Array<{ role: string }> } | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = init?.body
        ? (JSON.parse(init.body as string) as { messages: Array<{ role: string }> })
        : undefined;
      return jsonResponse({
        id: 'msg_3',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'final answer' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    };

    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const provider = createAnthropic({
      apiKey: 'sk-test',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const client = new VercelAILLMClient({ apiKey: 'sk-test', provider });

    await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'tu_1', content: '{"ok":true}' },
          ],
        },
      ],
      tools: [
        {
          name: 'search',
          description: '',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    // Anthropic Messages API expects the tool_result block under a
    // role: 'user' message (the API doesn't have a separate `tool` role).
    // The AI SDK's anthropic provider re-flattens ToolModelMessage back
    // into that shape on the wire.
    const roles = sentBody?.messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });
});
