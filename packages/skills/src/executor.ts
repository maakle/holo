import { AnthropicLLMClient, type LLMClient } from '@holo/llm';
import { holoError, ErrorCode } from '@holo/errors';
import type { SkillDoc } from './types';

export interface SkillStepResult {
  stepIndex: number;
  stepText: string;
}

/** Extract the Nth numbered step from a skill body. Returns null if out of bounds. */
export function runSkillStep(body: string, stepIndex: number): SkillStepResult | null {
  const lines = body.split('\n');
  const stepLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^Step \d+:/i.test(line)) {
      stepLines.push(i);
    }
  }

  if (stepIndex >= stepLines.length) return null;

  const start = stepLines[stepIndex];
  const end = stepIndex + 1 < stepLines.length ? stepLines[stepIndex + 1] : lines.length;
  const stepText = lines.slice(start, end).join('\n').trim();

  return { stepIndex, stepText };
}

export interface ExecuteSkillInput {
  skill: SkillDoc;
  userQuery: string;
  apiKey: string;
  maxSteps?: number;
  /** Inject for tests. Defaults to AnthropicLLMClient(apiKey). */
  client?: LLMClient;
}

export interface StepTrace {
  stepIndex: number;
  stepText: string;
  llmResponse: string;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
}

export interface ExecuteSkillResult {
  steps: StepTrace[];
  summary: string;
}

/**
 * Run a skill procedure step-by-step using Claude Haiku.
 * Each step is sent to the LLM with the skill body as system context.
 * The LLM explains what it would do for that step given the user query.
 */
export async function executeSkill(input: ExecuteSkillInput): Promise<ExecuteSkillResult> {
  const { skill, userQuery, apiKey, maxSteps = 10 } = input;
  const client = input.client ?? new AnthropicLLMClient({ apiKey });

  const systemPrompt = `You are executing a skill procedure. The skill is:

${skill.frontmatter.name}: ${skill.frontmatter.description}

Skill body:
${skill.body}

The user query triggering this skill execution: "${userQuery}"

For each step I give you, explain concisely (1-3 sentences) what you would do for that step given the user query. Identify any MCP tool calls this step would make. Be specific about query strings and parameters.`;

  const steps: StepTrace[] = [];

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const stepResult = runSkillStep(skill.body, stepIndex);
    if (!stepResult) break;

    let response;
    try {
      response = await client.complete({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Execute: ${stepResult.stepText}` }],
      });
    } catch (err) {
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `Skill execution failed at step ${stepIndex}: ${String(err)}`,
        fix: 'Check that the Anthropic API key is valid and the model is available.',
      });
    }

    const llmText = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');

    steps.push({
      stepIndex,
      stepText: stepResult.stepText,
      llmResponse: llmText,
      toolCalls: [], // populated via real tool-use round-trip in v0.3
    });
  }

  if (steps.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Skill has no executable steps (no "Step N:" lines found in body)',
      fix: 'Ensure the skill body contains at least one line matching "Step N: ..." format.',
    });
  }

  let summary: string;
  try {
    const summaryResponse = await client.complete({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 256,
      messages: [
        {
          role: 'user',
          content: `Summarize this skill execution in one sentence. Skill: ${skill.frontmatter.name}. Steps completed: ${steps.length}. User query: "${userQuery}"`,
        },
      ],
    });
    summary = summaryResponse.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('') || `Completed ${steps.length} steps.`;
  } catch {
    summary = `Completed ${steps.length} steps.`;
  }

  return { steps, summary };
}
