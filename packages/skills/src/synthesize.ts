import Anthropic from '@anthropic-ai/sdk';
import { holoError, ErrorCode } from '@holo/errors';
import { parseSkill } from './format';
import type { SkillDoc } from './types';

export interface LabeledArtifact {
  artifactId: string;
  kind: string;
  content: string;
}

export interface SynthesizeInput {
  skillSlug: string;
  labeledArtifacts: LabeledArtifact[];
  apiKey: string;
}

const SYNTHESIS_SYSTEM = `You are a procedure extraction specialist. Given a set of real work artifacts (Slack threads, pull requests, support tickets, call transcripts, documents) that all share a common procedure pattern, extract a reusable, parameterized skill template.

Output ONLY a valid YAML frontmatter + Markdown document in this exact format:

---
name: <slug-with-hyphens>
description: <one sentence: what this skill does and when to invoke it>
tools:
  - <holo mcp tool names used in steps; valid values: search, get_thread, get_pr, get_doc, get_call, get_ticket>
when_to_use: <2-3 sentences describing the trigger conditions>
---

# Procedure

Step 1: ...
Step 2: ...
(4-8 steps; each step should reference a specific tool or action)

## Examples

<1-2 realistic examples drawn from the provided artifacts>

Rules:
- name must match the provided slug exactly
- tools array must only contain: search, get_thread, get_pr, get_doc, get_call, get_ticket
- Steps must be concrete and tool-grounded (e.g. "Use search to find..."; "Use get_ticket to read...")
- Parameterize specifics: use [customer name], [ticket id], [repo name] instead of actual values
- No hallucinated tools or systems — only reference what appears in the artifacts
- Output must parse as valid YAML frontmatter`;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[... truncated ...]';
}

export async function synthesizeSkill(input: SynthesizeInput): Promise<SkillDoc> {
  if (input.labeledArtifacts.length < 2) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'At least 2 labeled artifacts are required for synthesis',
      fix: 'Label at least 2 example artifacts with this procedure name before synthesizing.',
    });
  }

  const client = new Anthropic({ apiKey: input.apiKey });

  const artifactBlocks = input.labeledArtifacts
    .map(
      (a, i) =>
        `### Artifact ${i + 1} (kind: ${a.kind})\n\n${truncate(a.content, 3000)}`,
    )
    .join('\n\n---\n\n');

  const userMessage = `Skill slug to extract: ${input.skillSlug}

The following ${input.labeledArtifacts.length} artifacts all represent examples of this procedure:

${artifactBlocks}

Extract the reusable procedure template for "${input.skillSlug}".`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: SYNTHESIS_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0];
  if (!raw || raw.type !== 'text') {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Synthesis returned empty or non-text response',
      fix: 'Retry synthesis. If this persists, check ANTHROPIC_API_KEY.',
    });
  }

  // Strip markdown code fences if Claude wrapped the output
  let skillText = raw.text.trim();
  const fenceMatch = skillText.match(/^```(?:yaml|markdown)?\n([\s\S]+?)\n```$/m);
  if (fenceMatch) {
    skillText = fenceMatch[1]!.trim();
  }

  // Enforce slug matches what was requested
  skillText = skillText.replace(/^name:\s*.+$/m, `name: ${input.skillSlug}`);

  try {
    return parseSkill(skillText);
  } catch (e) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Synthesis produced invalid skill YAML',
      cause: String(e),
      fix: 'Try adding more or better-quality labeled examples and retry synthesis.',
    });
  }
}
