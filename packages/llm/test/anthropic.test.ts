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

    const sent = (
      create.mock.calls[0] as Array<{ tools: Array<{ input_schema: unknown; cache_control?: unknown }> }>
    )[0];
    expect(sent.tools![0]!.input_schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });
    // Sole tool is also the last tool, so it carries the cache breakpoint
    // that covers the whole tools array.
    expect(sent.tools![0]!.cache_control).toEqual({ type: 'ephemeral' });
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

  it('attaches ephemeral cache_control to system, last tool, and last message', async () => {
    const { sdk, create } = makeFakeSdk({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new AnthropicLLMClient({ apiKey: 'sk-test', sdk });

    await client.complete({
      model: 'claude-test',
      maxTokens: 256,
      system: 'be helpful',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ],
      tools: [
        { name: 'a', description: '', inputSchema: { type: 'object' } },
        { name: 'b', description: '', inputSchema: { type: 'object' } },
      ],
    });

    const sent = (create.mock.calls[0] as Array<{
      system: Array<{ text: string; cache_control?: unknown }>;
      messages: Array<{ content: string | Array<{ cache_control?: unknown }> }>;
      tools: Array<{ name: string; cache_control?: unknown }>;
    }>)[0];

    // System block carries the breakpoint.
    expect(sent.system[0]!.cache_control).toEqual({ type: 'ephemeral' });

    // Only the LAST tool is marked (the breakpoint covers the whole array).
    expect(sent.tools[0]!.cache_control).toBeUndefined();
    expect(sent.tools[1]!.cache_control).toEqual({ type: 'ephemeral' });

    // The last message's content was promoted to a content-block array with
    // cache_control on the last block.
    const last = sent.messages[sent.messages.length - 1]!;
    expect(Array.isArray(last.content)).toBe(true);
    const blocks = last.content as Array<{ cache_control?: unknown }>;
    expect(blocks[blocks.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
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
