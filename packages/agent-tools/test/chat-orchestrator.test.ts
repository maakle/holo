import { describe, it, expect } from 'vitest';
import type { LLMClient, LLMRequest, LLMResponse } from '@holo/llm';
import {
  runChatAgentLoop,
  type ChatAgentEvent,
  type ChatLocalTool,
  type ChatToolContext,
} from '../src/chat-orchestrator';

// Fake LLM that replays a scripted sequence of responses. Each call pops the
// next response; if any responses are left over at the end, the test fails.
function scriptedLLM(script: LLMResponse[]): {
  client: LLMClient;
  calls: LLMRequest[];
  remaining: () => number;
} {
  const queue = [...script];
  const calls: LLMRequest[] = [];
  return {
    calls,
    remaining: () => queue.length,
    client: {
      complete(req: LLMRequest): Promise<LLMResponse> {
        // Snapshot messages by value so callers can inspect the state at the
        // moment of the call without being affected by later loop mutations.
        calls.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
        const next = queue.shift();
        if (!next) throw new Error('scriptedLLM: no more responses queued');
        return Promise.resolve(next);
      },
    },
  };
}

// Minimal tool context — the tools registered in each test never touch the db,
// so we don't need a real Drizzle handle.
const baseCtx: ChatToolContext = {
  // The real shape is a Drizzle DB; cast is safe because our test tools
  // never read it.
  db: {} as ChatToolContext['db'],
  organizationId: 'org-test',
  userSubjects: ['org:org-test', 'user:user-test'],
};

const echoTool: ChatLocalTool = {
  name: 'echo',
  description: 'Returns its input unchanged.',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  async run(_ctx, args) {
    return { echoed: args };
  },
};

const failingTool: ChatLocalTool = {
  name: 'broken',
  description: 'Always throws.',
  inputSchema: { type: 'object', properties: {} },
  async run() {
    throw new Error('boom');
  },
};

describe('runChatAgentLoop', () => {
  it('returns the assistant text on a direct end_turn (no tools used)', async () => {
    const { client, calls } = scriptedLLM([
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Hello there.' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'hi' }],
      tools: [echoTool],
    });

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('unreachable');
    expect(result.answer).toBe('Hello there.');
    expect(result.toolCalls).toEqual([]);
    expect(result.modelCalls).toBe(1);
    // RFC-0008: every answer carries a stable id the client uses to attach
    // feedback. UUIDv4 from crypto.randomUUID() — assert shape, not value.
    expect(result.answerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // Tools were registered in the request despite not being used. The
    // synthetic `emit_claims` tool is always appended after the caller's
    // tools (RFC-0007 is on by default).
    expect(calls[0]?.tools?.map((t) => t.name)).toEqual(['echo', 'emit_claims']);
  });

  it('dispatches tool_use, feeds the result back, then returns the final answer', async () => {
    const { client, calls } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'echo',
            input: { value: 'ping' },
          },
        ],
      },
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Tool returned ping.' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'use the echo tool' }],
      tools: [echoTool],
    });

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('unreachable');
    expect(result.answer).toBe('Tool returned ping.');
    expect(result.modelCalls).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'call-1',
      name: 'echo',
      input: { value: 'ping' },
      output: { echoed: { value: 'ping' } },
    });
    expect(result.toolCalls[0]?.isError).toBeUndefined();

    // The second model call must have the tool_result block appended.
    const secondCall = calls[1]!;
    const lastMsg = secondCall.messages[secondCall.messages.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const blocks = lastMsg.content as Array<{ type: string; toolUseId?: string }>;
    expect(blocks[0]?.type).toBe('tool_result');
    expect(blocks[0]?.toolUseId).toBe('call-1');
  });

  it('records tool errors as isError traces and continues the loop', async () => {
    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'broken',
            input: {},
          },
        ],
      },
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Tool failed; reporting.' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'try it' }],
      tools: [failingTool],
    });

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('unreachable');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.isError).toBe(true);
    expect(result.toolCalls[0]?.output).toBe('tool error: boom');
  });

  it('records unregistered-tool dispatches as isError traces', async () => {
    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'not_a_tool',
            input: {},
          },
        ],
      },
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'recovered' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'try a bogus tool' }],
      tools: [echoTool],
    });

    if (result.kind !== 'answer') throw new Error('expected answer');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'not_a_tool',
      isError: true,
      output: 'tool not_a_tool not registered',
    });
  });

  it('returns tool_cap_exceeded when too many tool calls fire', async () => {
    // Three tool_use turns in a row should trip a cap of 2.
    const toolTurn = {
      stopReason: 'tool_use' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 'call-x',
          name: 'echo',
          input: { value: 'x' },
        },
      ],
    };
    const { client } = scriptedLLM([toolTurn, toolTurn, toolTurn]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'loop forever' }],
      tools: [echoTool],
      maxToolCalls: 2,
    });

    expect(result.kind).toBe('tool_cap_exceeded');
    if (result.kind !== 'tool_cap_exceeded') throw new Error('unreachable');
    expect(result.maxToolCalls).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
  });

  it('emits model and tool lifecycle events via onEvent in order', async () => {
    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'echo',
            input: { value: 'hi' },
          },
        ],
      },
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'done.' }],
      },
    ]);

    const events: ChatAgentEvent[] = [];
    await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'echo it' }],
      tools: [echoTool],
      onEvent: (e) => events.push(e),
    });

    const kinds = events.map((e) => e.type);
    expect(kinds).toEqual([
      'model_start',
      'model_end',
      'tool_start',
      'tool_end',
      'model_start',
      'model_end',
    ]);
    const toolStart = events[2];
    expect(toolStart).toMatchObject({
      type: 'tool_start',
      name: 'echo',
      input: { value: 'hi' },
    });
    const toolEnd = events[3];
    expect(toolEnd).toMatchObject({
      type: 'tool_end',
      name: 'echo',
      output: { echoed: { value: 'hi' } },
    });
  });

  it('swallows onEvent callback errors so the loop still completes', async () => {
    const { client } = scriptedLLM([
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'hi' }],
      tools: [echoTool],
      onEvent: () => {
        throw new Error('transport broke');
      },
    });

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('unreachable');
    expect(result.answer).toBe('ok');
  });

  it('returns wall_clock_exceeded when the budget is blown before the next LLM call', async () => {
    // Use an injected `now` that jumps past the wall clock budget after the
    // first LLM round-trip.
    let tick = 0;
    const now = () => {
      tick += 1;
      // First call (startedAt) = 0, second (loop guard, second iter) = 999_999.
      return tick === 1 ? 0 : 999_999;
    };

    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'echo',
            input: { value: 'x' },
          },
        ],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [echoTool],
      wallClockMs: 1_000,
      now,
    });

    expect(result.kind).toBe('wall_clock_exceeded');
    if (result.kind !== 'wall_clock_exceeded') throw new Error('unreachable');
    expect(result.wallClockMs).toBe(1_000);
  });

  it('renumbers citations across multiple search tool calls and exposes them on the answer', async () => {
    // Fake `search` tool that returns two citations per call, both starting at
    // index 1. The orchestrator must renumber the second call's indices to
    // continue from where the first left off (3, 4) so the model sees a
    // single monotonic namespace.
    let callIndex = 0;
    const fakeSearch: ChatLocalTool = {
      name: 'search',
      description: 'fake',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        callIndex += 1;
        const prefix = callIndex === 1 ? 'a' : 'b';
        return {
          results: [],
          citations: [
            {
              index: 1,
              chunk_id: `${prefix}1`,
              provider: 'github',
              artifact_kind: 'pr',
              label: `${prefix}1`,
              snippet: '',
            },
            {
              index: 2,
              chunk_id: `${prefix}2`,
              provider: 'github',
              artifact_kind: 'pr',
              label: `${prefix}2`,
              snippet: '',
            },
          ],
          coverage: {
            query: `q${callIndex}`,
            filters: {
              provider: null,
              account_ids: null,
              user_subjects_count: 1,
              top_k: 8,
            },
            passes: [],
            fallback_used: false,
            total_returned: 2,
            total_timings_ms: 1,
          },
        };
      },
    };

    const { client, calls } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          { type: 'tool_use', id: 's1', name: 'search', input: { q: 'first' } },
        ],
      },
      {
        stopReason: 'tool_use',
        content: [
          { type: 'tool_use', id: 's2', name: 'search', input: { q: 'second' } },
        ],
      },
      {
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'See [1] and [4].' }],
      },
    ]);

    const result = await runChatAgentLoop({
      llm: client,
      model: 'test-model',
      toolCtx: baseCtx,
      initialMessages: [{ role: 'user', content: 'find stuff' }],
      tools: [fakeSearch],
    });

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('unreachable');

    // Four citations total, renumbered 1..4.
    expect(result.citations.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    expect(result.citations.map((c) => c.chunk_id)).toEqual(['a1', 'a2', 'b1', 'b2']);

    // Both coverage payloads preserved, in call order.
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage[0]?.query).toBe('q1');
    expect(result.coverage[1]?.query).toBe('q2');

    // What the LLM saw on the SECOND search tool call: the renumbered indices
    // must appear in the tool_result content so the model can cite them
    // correctly. (calls[2] is the third LLM call; its last user message
    // is the second search's tool_result block.)
    const thirdCall = calls[2]!;
    const lastUser = thirdCall.messages[thirdCall.messages.length - 1]!;
    const blocks = lastUser.content as Array<{ type: string; content?: unknown }>;
    const toolResult = blocks[0] as { content: string };
    expect(toolResult.content).toContain('"index":3');
    expect(toolResult.content).toContain('"index":4');
    // And critically: the second call's payload no longer carries the
    // tool-emitted "1" / "2" — that would alias with the first call's
    // already-renumbered 1/2.
    expect(toolResult.content).not.toContain('"index":1');
  });
});
