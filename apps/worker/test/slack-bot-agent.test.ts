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
});
