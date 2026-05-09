// packages/discovery/src/propose.ts
import { AnthropicLLMClient, resolveAnthropicUtilityModel, type LLMClient } from '@holo/llm';
import { holoError, ErrorCode } from '@holo/errors';
import type { Proposal } from './types';

export interface ProposeInput {
  apiKey: string;
  artifacts: { kind: string; content: string }[];
  /** Inject for tests. Defaults to AnthropicLLMClient(apiKey). */
  client?: LLMClient;
}

const SYSTEM = `You are a procedure-naming assistant. Given a small bundle of related work artifacts (Slack messages, deals, meetings, docs, tickets) that all appear to be part of one repeatable process, propose a name for that procedure.

Output EXACTLY this format, no other text:
slug: <kebab-case slug, 2-5 words>
name: <Title Case Name, 2-5 words>
summary: <one sentence describing when this procedure runs and what it accomplishes>

The slug must be lowercase, hyphenated, contain only [a-z0-9-]. Avoid generic names like "process-message" or "handle-thing".`;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function proposeProcedureName(input: ProposeInput): Promise<Proposal> {
  const client = input.client ?? new AnthropicLLMClient({ apiKey: input.apiKey });
  const userBlock = input.artifacts
    .map((a, i) => `Artifact ${i + 1} (${a.kind}):\n${truncate(a.content, 1500)}`)
    .join('\n\n---\n\n');

  let response;
  try {
    response = await client.complete({
      model: resolveAnthropicUtilityModel(),
      maxTokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
    });
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Procedure naming LLM call failed: ${String(err)}`,
      fix: 'Check ANTHROPIC_API_KEY and network connectivity',
    });
  }

  if (response.stopReason !== 'end_turn') {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Procedure naming output was truncated',
      fix: 'Retry; if persistent, reduce artifact content length',
    });
  }

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const slug = text.match(/^slug:\s*([a-z0-9-]+)\s*$/m)?.[1];
  const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const summary = text.match(/^summary:\s*([\s\S]+?)$/m)?.[1]?.trim();

  if (!slug || !name || !summary) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Procedure naming output did not match expected format: ${truncate(text, 200)}`,
      fix: 'Retry; the LLM occasionally drifts from the format.',
    });
  }

  return { proposedSlug: slug, proposedName: name, summary };
}
