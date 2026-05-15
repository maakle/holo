import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../src/slack-bot/agent';
import type { ToolDefinition } from '@holo/agent-tools';
import type { LLMClient, LLMRequest, LLMResponse } from '@holo/llm';

// Scripted fake `LLMClient`. Each `complete` call pops the next scripted
// response; if any are left over at the end of a test, that's a sign the
// loop terminated earlier than expected (we don't fail on it because some
// tests intentionally script extra rounds the agent should never reach).
function scriptedLLM(script: LLMResponse[]): {
  client: LLMClient;
  calls: LLMRequest[];
} {
  const queue = [...script];
  const calls: LLMRequest[] = [];
  return {
    calls,
    client: {
      complete(req) {
        calls.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
        const next = queue.shift();
        if (!next) throw new Error('scriptedLLM: no more responses queued');
        return Promise.resolve(next);
      },
    },
  };
}

const fakeDb = {} as Parameters<typeof runAgent>[0]['db'];

describe('runAgent', () => {
  it('returns the assistant text on a single-shot answer with no tool calls', async () => {
    const { client, calls } = scriptedLLM([
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'The deploy uses Vercel.' }] },
    ]);

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
      llm: client,
      tools: [],
      orgName: 'Acme',
    });

    expect(result.answer).toBe('The deploy uses Vercel.');
    expect(result.sources).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('Acme');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'how do we deploy?' }]);
  });

  it('dispatches a tool_use, appends tool_result, and returns final text', async () => {
    const { client, calls } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'deploy', top_k: 10 } }],
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'Deploys go through Vercel.' }] },
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
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('Deploys go through Vercel.');
    expect(searchRun).toHaveBeenCalledTimes(1);
    expect(searchRun.mock.calls[0][1]).toEqual({ q: 'deploy', top_k: 10 });

    expect(calls).toHaveLength(2);
    // The second call should carry the tool_result block in the new user turn.
    const lastMsg = calls[1]!.messages[calls[1]!.messages.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const toolResult = (lastMsg.content as Array<{ type: string; toolUseId: string }>)[0];
    expect(toolResult!.type).toBe('tool_result');
    expect(toolResult!.toolUseId).toBe('toolu_1');

    // Caller-supplied tools + the synthetic emit_claims terminal tool the
    // shared agent loop always appends for the RFC-0007 claims protocol.
    expect(calls[0]!.tools?.map((t) => t.name)).toEqual(['search', 'emit_claims']);
  });

  it('passes input schemas through to the LLM client unmodified (anyOf flattening is the client\'s job)', async () => {
    // The shared loop forwards `inputSchema` as-is; provider-specific
    // shape conversion (e.g. flattening anyOf unions for Anthropic) lives
    // in the LLMClient adapter, not the agent loop. Asserting here keeps
    // that contract explicit.
    const { client, calls } = scriptedLLM([
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);

    const unionSchema = {
      anyOf: [
        { type: 'object', properties: { artifact_id: { type: 'string' } }, required: ['artifact_id'] },
        { type: 'object', properties: { notion_page_id: { type: 'string' } }, required: ['notion_page_id'] },
      ],
    };
    const tools: ToolDefinition[] = [
      { name: 'fetch_artifact', description: '', inputSchema: unionSchema, run: async () => ({}) },
    ];

    await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: '?',
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(calls[0]!.tools?.[0]!.inputSchema).toBe(unionSchema);
  });

  it('supports multi-hop: search → bash → final answer', async () => {
    const { client, calls } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'incident' } }],
      },
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't2',
            name: 'bash',
            input: { script: 'cat /slack/#incidents/2026-05-14/thread-1.1.md' },
          },
        ],
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'The incident was caused by a stale cache.' }] },
    ]);

    const searchRun = vi.fn(async () => ({ results: [] }));
    const bashRun = vi.fn(async () => ({ stdout: 'cache fix', stderr: '', exit_code: 0 }));

    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: searchRun },
      { name: 'bash', description: '', inputSchema: {}, run: bashRun },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'what happened in the incident?',
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('The incident was caused by a stale cache.');
    expect(searchRun).toHaveBeenCalledTimes(1);
    expect(bashRun).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
  });

  it('forwards tool runner exceptions as tool_result with isError: true', async () => {
    const { client, calls } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'I could not search.' }] },
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
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('I could not search.');
    const secondCallMessages = calls[1]!.messages;
    const toolResult = (
      secondCallMessages[secondCallMessages.length - 1]!.content as Array<{
        type: string;
        isError?: boolean;
        content: string;
      }>
    )[0]!;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content).toContain('database connection lost');
  });

  it('throws AgentRunawayError when tool call count exceeds maxToolCalls', async () => {
    const responses = Array.from({ length: 25 }, (_, i) => ({
      stopReason: 'tool_use' as const,
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'search', input: { q: 'x' } }],
    }));
    const { client } = scriptedLLM(responses);

    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
    ];

    await expect(
      runAgent({
        db: fakeDb,
        organizationId: 'org-1',
        userSubjects: ['org:org-1'],
        question: 'x?',
        llm: client,
        tools,
        orgName: 'Acme',
        maxToolCalls: 3,
      }),
    ).rejects.toMatchObject({ name: 'AgentRunawayError', reason: 'tool_call_cap' });
  });

  it('throws AgentRunawayError when wall clock budget exceeded', async () => {
    const { client } = scriptedLLM([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]);

    const ticks = [0, 200_000];
    const now = vi.fn(() => ticks.shift() ?? 200_000);

    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
    ];

    await expect(
      runAgent({
        db: fakeDb,
        organizationId: 'org-1',
        userSubjects: ['org:org-1'],
        question: 'x?',
        llm: client,
        tools,
        orgName: 'Acme',
        wallClockMs: 60_000,
        now,
      }),
    ).rejects.toMatchObject({ name: 'AgentRunawayError', reason: 'wall_clock_cap' });
  });

  it('builds sources from the search tool\'s citations[] in renumbered order', async () => {
    // Search tool output carries a structured `citations[]` array (1-based,
    // label + url + snippet), and we collect from THAT — not from `results[]`.
    // Position N in result.sources corresponds 1:1 with the `[N]` reference
    // the model is told to emit, so `[1]` in the answer text resolves to
    // sources[0].
    const { client } = scriptedLLM([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'deploy' } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'Deploys go via Vercel [1][2].' }] },
    ]);

    const tools: ToolDefinition[] = [
      {
        name: 'search', description: '', inputSchema: {},
        run: async () => ({
          results: [],
          citations: [
            { index: 1, chunk_id: 'c1', provider: 'github', artifact_kind: 'doc', label: 'A.md · acme/web', snippet: '...', url: 'https://github.com/acme/web/blob/HEAD/A.md' },
            { index: 2, chunk_id: 'c2', provider: 'github', artifact_kind: 'doc', label: 'B.md · acme/web', snippet: '...', url: 'https://github.com/acme/web/blob/HEAD/B.md' },
            { index: 3, chunk_id: 'c3', provider: 'notion', artifact_kind: 'page', label: 'Notion — Deploy Runbook', snippet: '...', url: 'https://www.notion.so/abc' },
          ],
        }),
      },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(result.answer).toBe('Deploys go via Vercel [1][2].');
    expect(result.sources).toEqual([
      { provider: 'github', kind: 'doc', title: 'A.md · acme/web', url: 'https://github.com/acme/web/blob/HEAD/A.md' },
      { provider: 'github', kind: 'doc', title: 'B.md · acme/web', url: 'https://github.com/acme/web/blob/HEAD/B.md' },
      { provider: 'notion', kind: 'page', title: 'Notion — Deploy Runbook', url: 'https://www.notion.so/abc' },
    ]);
  });

  it('renumbers citations across multiple search calls into one monotonic namespace', async () => {
    // Two search calls each return 1-indexed citations starting at 1. The
    // shared loop offsets the second call's indices so the model sees and
    // we render a single [1]..[N] sequence. Otherwise `[2]` in the answer
    // would ambiguously refer to two different sources.
    const { client, calls } = scriptedLLM([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'a' } }] },
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'search', input: { q: 'b' } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'Multi-source answer [1][3].' }] },
    ]);

    let call = 0;
    const tools: ToolDefinition[] = [
      {
        name: 'search', description: '', inputSchema: {},
        run: async () => {
          call += 1;
          if (call === 1) {
            return {
              results: [],
              citations: [
                { index: 1, chunk_id: 'c1', provider: 'github', artifact_kind: 'doc', label: 'A.md', snippet: '...', url: 'https://example.com/a' },
                { index: 2, chunk_id: 'c2', provider: 'github', artifact_kind: 'doc', label: 'B.md', snippet: '...', url: 'https://example.com/b' },
              ],
            };
          }
          return {
            results: [],
            citations: [
              { index: 1, chunk_id: 'c3', provider: 'github', artifact_kind: 'doc', label: 'C.md', snippet: '...', url: 'https://example.com/c' },
            ],
          };
        },
      },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: '?',
      llm: client,
      tools,
      orgName: 'Acme',
    });

    // Sources should be in renumbered order: [1]=A, [2]=B, [3]=C
    expect(result.sources.map((s) => s.title)).toEqual(['A.md', 'B.md', 'C.md']);

    // The model on the second call should have seen the second batch's
    // citations RENUMBERED to start at index 3 (offset by 2 from the first
    // call), not the raw `1` the tool stub returned.
    const secondModelCall = calls[1]!;
    const firstToolResultMsg = secondModelCall.messages.find(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>)[0]?.type === 'tool_result',
    );
    const firstToolResult = (firstToolResultMsg!.content as Array<{ content: string }>)[0]!;
    expect(firstToolResult.content).toContain('"index":1');
    expect(firstToolResult.content).toContain('"index":2');

    const thirdModelCall = calls[2]!;
    const secondToolResultMsg = thirdModelCall.messages
      .filter((m) => Array.isArray(m.content))
      .at(-1)!.content as Array<{ content: string }>;
    expect(secondToolResultMsg[0]!.content).toContain('"index":3');
  });

  it('omits sources whose citation has no url (label-only fallback)', async () => {
    // A citation without a `url` field (provider we can't deep-link, e.g.
    // Salesforce today) still belongs in the sources list so `[N]` resolves
    // — just rendered label-only by the blocks layer.
    const { client } = scriptedLLM([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'ok [1].' }] },
    ]);

    const tools: ToolDefinition[] = [
      {
        name: 'search', description: '', inputSchema: {},
        run: async () => ({
          results: [],
          citations: [
            { index: 1, chunk_id: 'c1', provider: 'salesforce', artifact_kind: 'account', label: 'Salesforce account — Acme', snippet: '...' },
          ],
        }),
      },
    ];

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: '?',
      llm: client,
      tools,
      orgName: 'Acme',
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      provider: 'salesforce',
      kind: 'account',
      title: 'Salesforce account — Acme',
    });
    expect(result.sources[0]!.url).toBeUndefined();
  });

  it('honors emit_claims terminally: returns claims and annotates the answer when any are unverified (RFC-0007)', async () => {
    // The slack bot uses the same claims protocol as the web chat. When the
    // model hard-gates a quantitative customer claim (regex-matched in the
    // shared classifier), the server-side enforcement downgrades it to
    // `unverified` and `appendUnverifiedNoteIfNeeded` tacks a "Note: I
    // couldn't verify…" footer onto the answer text — slack's user-visible
    // surrogate for the web's confidence-chip banner.
    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'ec',
            name: 'emit_claims',
            input: {
              answer: 'Acme is at $50,000 ARR.',
              claims: [
                {
                  // Hard-gated shape (currency-with-suffix near customer
                  // mention). No citation → must be marked unverified.
                  text: 'Acme is at $50,000 ARR',
                  confidence: 'high',
                  citation_indices: [],
                },
              ],
            },
          },
        ],
      },
    ]);

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'what is Acme at?',
      llm: client,
      tools: [],
      orgName: 'Acme',
    });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.confidence).toBe('unverified');
    expect(result.claims[0]!.reason).toBeDefined();
    expect(result.answer).toContain("Heads up — I couldn't find");
  });

  it('translates shared-loop events into the legacy slack logEvent signature', async () => {
    // `agent-runner.ts` consumes `model_call` / `tool_call` / `tool_error`
    // for both audit (`recordAgentEventForSlack`) and Slack-mrkdwn progress
    // (`progressTextForEvent`). The slack wrapper adapts the new structured
    // events at the boundary; verify the legacy shape still arrives.
    const { client } = scriptedLLM([
      {
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ]);

    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const tools: ToolDefinition[] = [
      { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
    ];

    await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: '?',
      llm: client,
      tools,
      orgName: 'Acme',
      logEvent: (event, fields) => events.push({ event, fields }),
    });

    const eventKinds = events.map((e) => e.event);
    expect(eventKinds).toEqual(['model_call', 'tool_call', 'model_call']);
    const firstModelCall = events[0]!.fields;
    expect(firstModelCall.callIndex).toBe(1);
    expect(typeof firstModelCall.model).toBe('string');
    expect(typeof firstModelCall.durationMs).toBe('number');
    const toolCall = events[1]!.fields;
    expect(toolCall.tool).toBe('search');
    expect(toolCall.input).toEqual({ q: 'x' });
  });
});
