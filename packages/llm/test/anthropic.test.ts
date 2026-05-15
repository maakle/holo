import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicLLMClient } from '../src/anthropic';

function makeFakeSdk(response: unknown) {
  const create = vi.fn(async () => response);
  return {
    create,
    sdk: { messages: { create } } as unknown as Anthropic,
  };
}

describe('AnthropicLLMClient', () => {
  it('flattens anyOf input_schemas before sending to the Anthropic API', async () => {
    const { sdk, create } = makeFakeSdk({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = new AnthropicLLMClient({ apiKey: 'sk-test', sdk });

    await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'fetch',
          description: '',
          inputSchema: {
            anyOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
              { type: 'object', properties: { b: { type: 'string' } } },
            ],
          },
        },
      ],
    });

    const sent = (create.mock.calls[0] as Array<{ tools: Array<{ input_schema: unknown }> }>)[0];
    expect(sent.tools![0]!.input_schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });
  });

  it('surfaces usage (input/output/cache tokens) on the LLMResponse', async () => {
    const { sdk } = makeFakeSdk({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 80,
      },
    });
    const client = new AnthropicLLMClient({ apiKey: 'sk-test', sdk });

    const result = await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 80,
    });
  });

  it('returns text + tool_use blocks and maps stop_reason', async () => {
    const { sdk } = makeFakeSdk({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'thinking…' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new AnthropicLLMClient({ apiKey: 'sk-test', sdk });

    const result = await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'text', text: 'thinking…' },
      { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } },
    ]);
  });
});
