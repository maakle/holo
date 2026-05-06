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
});
