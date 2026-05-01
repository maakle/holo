import Anthropic from '@anthropic-ai/sdk';
import { holoError, ErrorCode } from '@holo/errors';

const REDACTION_SYSTEM =
  'You are a skill redaction system. Remove all company-specific names, internal URLs, Slack channel names, project codenames, and any PII from this skill document. Preserve the procedure and structure. Return only the redacted markdown document.';

const MAX_INPUT_CHARS = 8000;

export async function redactSkill(content: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });

  const truncated =
    content.length > MAX_INPUT_CHARS ? content.slice(0, MAX_INPUT_CHARS) + '\n[... truncated ...]' : content;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: REDACTION_SYSTEM,
    messages: [{ role: 'user', content: truncated }],
  });

  const raw = response.content[0];
  if (!raw || raw.type !== 'text') {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Redaction returned empty or non-text response',
      fix: 'Retry the publish operation. If this persists, check ANTHROPIC_API_KEY.',
    });
  }

  return raw.text.trim();
}
