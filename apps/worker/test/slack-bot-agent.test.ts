import { describe, it, expect, vi } from 'vitest';
import { runAgent, AgentRunawayError } from '../src/slack-bot/agent';
import type { ToolDefinition } from '@holo/agent-tools';

function makeFakeAnthropic(responses: Array<{
  stop_reason: 'end_turn' | 'tool_use';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
}>) {
  const queue = [...responses];
  const create = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('no more responses queued');
    return next;
  });
  return {
    client: { messages: { create } } as unknown as Parameters<typeof runAgent>[0]['client'],
    create,
  };
}

const fakeDb = {} as Parameters<typeof runAgent>[0]['db'];

describe('runAgent', () => {
  it('returns the assistant text on a single-shot answer with no tool calls', async () => {
    const { client, create } = makeFakeAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The deploy uses Vercel.' }] },
    ]);

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
      client,
      tools: [],
      orgName: 'Acme',
    });

    expect(result.answer).toBe('The deploy uses Vercel.');
    expect(result.sources).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0] as { system: string; messages: unknown[] };
    expect(callArgs.system).toContain('Acme');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'how do we deploy?' }]);
  });

  it('dispatches a tool_use, appends tool_result, and returns final text', async () => {
    const { client, create } = makeFakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'deploy', top_k: 10 } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Deploys go through Vercel.' }] },
    ]);

    const searchRun = vi.fn(async () => ({
      results: [
        {
          chunk_id: 'c1',
          content: 'Vercel deploys on push to main.',
          score: 0.9,
          source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
          snippet_url: 'https://github.com/acme/web/blob/HEAD/DEPLOY.md',
        },
      ],
    }));
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Hybrid search.',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        run: searchRun,
      },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
      client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('Deploys go through Vercel.');
    expect(searchRun).toHaveBeenCalledTimes(1);
    expect(searchRun.mock.calls[0][1]).toEqual({ q: 'deploy', top_k: 10 });

    expect(create).toHaveBeenCalledTimes(2);
    const secondCall = create.mock.calls[1][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const toolResult = (lastMsg.content as Array<{ type: string; tool_use_id: string }>)[0];
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.tool_use_id).toBe('toolu_1');

    const firstCall = create.mock.calls[0][0] as { tools: Array<{ name: string; input_schema: unknown }> };
    expect(firstCall.tools).toHaveLength(1);
    expect(firstCall.tools[0].name).toBe('search');
    expect(firstCall.tools[0].input_schema).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
    });
  });

  it('supports multi-hop: search → get_thread → final answer', async () => {
    const { client, create } = makeFakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'incident' } }],
      },
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't2', name: 'get_thread', input: { channel: 'C1', ts: '1.1' } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The incident was caused by a stale cache.' }] },
    ]);

    const searchRun = vi.fn(async () => ({ results: [] }));
    const threadRun = vi.fn(async () => ({ messages: [{ user: 'U1', text: 'cache fix' }] }));

    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: searchRun },
      { name: 'get_thread', description: '', inputSchema: {}, run: threadRun },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'what happened in the incident?',
      client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('The incident was caused by a stale cache.');
    expect(searchRun).toHaveBeenCalledTimes(1);
    expect(threadRun).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('forwards tool runner exceptions as tool_result with is_error: true', async () => {
    const { client, create } = makeFakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I could not search.' }] },
    ]);

    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: '',
        inputSchema: {},
        run: async () => { throw new Error('database connection lost'); },
      },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'x?',
      client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('I could not search.');
    const secondCallMessages = (create.mock.calls[1][0] as {
      messages: Array<{ role: string; content: unknown }>;
    }).messages;
    const toolResult = (
      secondCallMessages[secondCallMessages.length - 1].content as Array<{
        type: string;
        is_error?: boolean;
        content: string;
      }>
    )[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain('database connection lost');
  });

  it('throws AgentRunawayError when tool call count exceeds maxToolCalls', async () => {
    const responses = Array.from({ length: 25 }, (_, i) => ({
      stop_reason: 'tool_use' as const,
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'search', input: { q: 'x' } }],
    }));
    const { client } = makeFakeAnthropic(responses);

    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
    ];

    await expect(
      runAgent({
        db: fakeDb,
        organizationId: 'org-1',
        userSubjects: ['org:org-1'],
        question: 'x?',
        client,
        tools,
        orgName: 'Acme',
        maxToolCalls: 3,
      }),
    ).rejects.toMatchObject({ name: 'AgentRunawayError', reason: 'tool_call_cap' });
  });
});
