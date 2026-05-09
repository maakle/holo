import { resolveAnthropicAgentModel } from '@holo/llm';

// Single source of truth for the model the in-app agent calls. Imported by
// the chat API route and the chat page so the UI label can never drift from
// the actual model id sent to Anthropic. Honours `ANTHROPIC_AGENT_MODEL` if
// set; defaults to the latest Sonnet otherwise. Read once at module load —
// changing the env requires a redeploy, matching the operational pattern
// for embedder + connector config.
export const CHAT_MODEL_ID = resolveAnthropicAgentModel();
