import { describe, it, expect } from 'vitest';
import type { LLMClient, LLMRequest, LLMResponse } from '@holo/llm';
import {
  runChatAgentLoop,
  type ChatLocalTool,
  type ChatToolContext,
} from '../src/chat-orchestrator';
import { EMIT_CLAIMS_TOOL_NAME } from '../src/claims';

// Scripted LLM, same shape as in chat-orchestrator.test.ts. Kept local
// instead of imported so this file is self-contained and reads top-down.
function scriptedLLM(script: LLMResponse[]): {
  client: LLMClient;
  calls: LLMRequest[];
} {
  const queue = [...script];
  const calls: LLMRequest[] = [];
  return {
    calls,
    client: {
      complete(req: LLMRequest): Promise<LLMResponse> {
        calls.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
        const next = queue.shift();
        if (!next) throw new Error('scriptedLLM: no more responses queued');
        return Promise.resolve(next);
      },
    },
  };
}

const baseCtx: ChatToolContext = {
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

describe('runChatAgentLoop — claims envelope (RFC-0007)', () => {
  describe('bare end_turn (model skipped emit_claims)', () => {
    it('returns an empty claims array — the answer text still surfaces', async () => {
      const { client, calls } = scriptedLLM([
        {
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'plain answer' }],
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
      expect(result.answer).toBe('plain answer');
      expect(result.claims).toEqual([]);
      // emit_claims is always advertised now — the loop is always claim-aware.
      const toolNames = calls[0]?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain(EMIT_CLAIMS_TOOL_NAME);
    });
  });

  describe('emit_claims happy path', () => {
    it('advertises emit_claims as a tool', async () => {
      const { client, calls } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'ok',
                claims: [
                  { text: 'ok', confidence: 'medium', citation_indices: [] },
                ],
              },
            },
          ],
        },
      ]);

      await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'hi' }],
        tools: [echoTool],
      });

      const toolNames = calls[0]?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).toContain(EMIT_CLAIMS_TOOL_NAME);
      expect(toolNames).toContain('echo');
    });

    it('returns claims on the answer when the model calls emit_claims', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'Notion has 3 active sources [1].',
                claims: [
                  {
                    text: 'Notion has 3 active sources',
                    confidence: 'high',
                    citation_indices: [1],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'how many notion sources' }],
        tools: [echoTool],
      });

      expect(result.kind).toBe('answer');
      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.answer).toBe('Notion has 3 active sources [1].');
      expect(result.claims).toEqual([
        {
          text: 'Notion has 3 active sources',
          confidence: 'high',
          citation_indices: [1],
        },
      ]);
    });

    it('treats emit_claims as terminal — no further LLM call is made', async () => {
      // Only one scripted response — if the loop tried to continue, it'd
      // throw "no more responses queued".
      const { client, calls } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'done',
                claims: [
                  { text: 'done', confidence: 'medium', citation_indices: [] },
                ],
              },
            },
          ],
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
      expect(calls).toHaveLength(1);
    });
  });

  describe('server-side downgrade — high + no citations → medium', () => {
    it('downgrades and stamps reason: "no citation matched"', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'The team prefers async standups.',
                claims: [
                  {
                    text: 'The team prefers async standups',
                    confidence: 'high',
                    citation_indices: [],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'standups?' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.claims).toEqual([
        {
          text: 'The team prefers async standups',
          confidence: 'medium',
          citation_indices: [],
          reason: 'no citation matched',
        },
      ]);
    });

    it('does NOT downgrade a high claim that has at least one citation', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'Async standups [1].',
                claims: [
                  {
                    text: 'Async standups',
                    confidence: 'high',
                    citation_indices: [1],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'standups?' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.claims?.[0]?.confidence).toBe('high');
    });
  });

  describe('hard-gate — quantitative customer claim with empty citations', () => {
    it('marks the claim unverified with a stable reason', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'Acme pays $250k ARR.',
                claims: [
                  {
                    text: 'Acme pays $250k ARR',
                    // Even if the model claimed high here, hard-gate trumps.
                    confidence: 'high',
                    citation_indices: [],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'how much does acme pay?' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      const claim = result.claims?.[0];
      expect(claim?.confidence).toBe('unverified');
      expect(claim?.reason).toBeDefined();
    });

    it('appends a "couldn\'t verify" note to the answer text', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'Skello has 120 seats.',
                claims: [
                  {
                    text: 'Skello has 120 seats',
                    confidence: 'high',
                    citation_indices: [],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'seats?' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.answer).toContain('Heads up');
    });

    it('does NOT hard-gate a quantitative claim that has citations', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'Skello has 120 seats [1].',
                claims: [
                  {
                    text: 'Skello has 120 seats',
                    confidence: 'high',
                    citation_indices: [1],
                  },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'seats?' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.claims?.[0]?.confidence).toBe('high');
      expect(result.answer).not.toContain('Heads up');
    });
  });

  describe('emit_claims input parsing robustness', () => {
    it('drops malformed claim entries without crashing', async () => {
      const { client } = scriptedLLM([
        {
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'ec',
              name: EMIT_CLAIMS_TOOL_NAME,
              input: {
                answer: 'partial',
                claims: [
                  // Valid
                  { text: 'ok', confidence: 'medium', citation_indices: [] },
                  // Missing text → dropped
                  { confidence: 'medium', citation_indices: [] },
                  // Bad confidence → defaulted to medium
                  { text: 'weird', confidence: 'nonsense', citation_indices: [] },
                  // Bad indices → coerced to []
                  { text: 'b', confidence: 'high', citation_indices: 'not an array' },
                ],
              },
            },
          ],
        },
      ]);

      const result = await runChatAgentLoop({
        llm: client,
        model: 'test-model',
        toolCtx: baseCtx,
        initialMessages: [{ role: 'user', content: 'hi' }],
        tools: [echoTool],
      });

      if (result.kind !== 'answer') throw new Error('unreachable');
      expect(result.claims).toBeDefined();
      // 3 valid claims preserved (the missing-text one was dropped).
      expect(result.claims).toHaveLength(3);
      const second = result.claims?.[1];
      expect(second?.confidence).toBe('medium'); // defaulted from "nonsense"
      const third = result.claims?.[2];
      expect(third?.citation_indices).toEqual([]); // coerced from string
    });
  });
});
