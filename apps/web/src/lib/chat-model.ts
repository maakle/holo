// Single source of truth for the model the in-app agent calls. Imported by
// the chat API route and the chat page so the UI label can never drift from
// the actual model id sent to Anthropic.
export const CHAT_MODEL_ID = 'claude-sonnet-4-6';
