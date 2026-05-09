import Anthropic from '@anthropic-ai/sdk';
import { holoError, ErrorCode } from '@holo/errors';
import { resolveAnthropicUtilityModel } from '@holo/llm';

export interface InvocationRecord {
  toolName: string;
  inputJson: Record<string, unknown>;
}

export interface InvocationCluster {
  toolName: string;
  count: number;
  examples: Record<string, unknown>[];
}

export function clusterInvocations(invocations: InvocationRecord[]): InvocationCluster[] {
  const byTool = new Map<string, Record<string, unknown>[]>();
  for (const inv of invocations) {
    const existing = byTool.get(inv.toolName) ?? [];
    existing.push(inv.inputJson);
    byTool.set(inv.toolName, existing);
  }
  return Array.from(byTool.entries())
    .map(([toolName, examples]) => ({
      toolName,
      count: examples.length,
      examples: examples.slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface AutoExtractInput {
  invocations: InvocationRecord[];
  apiKey: string;
  maxProposals?: number;
}

export interface SkillProposal {
  slug: string;
  name: string;
  description: string;
  suggestedTools: string[];
  content: string;
}

export async function autoExtractSkills(input: AutoExtractInput): Promise<SkillProposal[]> {
  const { invocations, apiKey, maxProposals = 3 } = input;
  const clusters = clusterInvocations(invocations);
  if (clusters.length === 0) return [];

  const client = new Anthropic({ apiKey });
  const clusterSummary = clusters
    .slice(0, 10)
    .map((c) => `- ${c.toolName} called ${c.count}x (example: ${JSON.stringify(c.examples[0])})`)
    .join('\n');

  const prompt = `You are a skill extraction system. Based on these MCP tool invocation patterns from an AI agent, propose ${maxProposals} reusable skills in Anthropic Skill format.

Invocation patterns:
${clusterSummary}

For each skill, output YAML frontmatter + markdown body. Use EXACTLY this separator between skills: ---SKILL_SEPARATOR---

Format for each skill:
---
name: slug-case-name
description: one sentence description
tools: [tool1, tool2]
when_to_use: trigger condition
executable: true
tool_allowlist: [tools this skill needs]
---

# Procedure

Step 1: action
Step 2: action

## Examples

brief example

Output exactly ${maxProposals} skills separated by ---SKILL_SEPARATOR---. No other text outside the skill blocks.`;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolveAnthropicUtilityModel(),
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Auto-extraction LLM call failed: ${String(err)}`,
      fix: 'Check ANTHROPIC_API_KEY and network connectivity',
    });
  }

  if (response.stop_reason !== 'end_turn') {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Auto-extraction output was truncated',
      fix: 'Try with fewer invocations or reduce maxProposals',
    });
  }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const skillBlocks = rawText
    .split('---SKILL_SEPARATOR---')
    .map((s) => s.trim())
    .filter(Boolean);

  const proposals: SkillProposal[] = [];
  for (const block of skillBlocks.slice(0, maxProposals)) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const descMatch = block.match(/^description:\s*(.+)$/m);
    const toolsMatch = block.match(/^tools:\s*\[(.+)\]/m);
    if (!nameMatch || !descMatch) continue;

    const slug = (nameMatch[1] ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    const rawTools = toolsMatch ? (toolsMatch[1] ?? '') : '';
    const suggestedTools = rawTools
      .split(',')
      .map((t) => t.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    proposals.push({ slug, name: (nameMatch[1] ?? '').trim(), description: (descMatch[1] ?? '').trim(), suggestedTools, content: block });
  }
  return proposals;
}
