/**
 * Centralised Anthropic model selection. Two roles:
 *
 *   - **agent** — the user-facing conversational model (web chat,
 *     Slack bot). Quality matters more than cost here; default is
 *     Sonnet.
 *   - **utility** — background pipeline tasks (skill auto-extract,
 *     discovery proposals, redaction, label synthesis). High volume,
 *     short prompts; default is Haiku.
 *
 * Operators override per-deploy via `ANTHROPIC_AGENT_MODEL` and
 * `ANTHROPIC_UTILITY_MODEL`. Per-customer selection is intentionally
 * out of scope: model choice affects answer quality, latency, and
 * cost in ways that are operationally easier to manage centrally.
 *
 * Model strings are passed through to Anthropic as-is — we don't
 * maintain a closed allowlist because Anthropic ships new models
 * routinely (often with dated suffixes like `-20251001`). A typo
 * surfaces as a clear `model_not_found` from the SDK on the first
 * call, not silent miswiring.
 *
 * env is read on every call (not cached) so tests can flip values
 * per-case via `vi.stubEnv`.
 */

const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_UTILITY_MODEL = 'claude-haiku-4-5-20251001';

export function resolveAnthropicAgentModel(): string {
  const raw = process.env.ANTHROPIC_AGENT_MODEL;
  return raw && raw.length > 0 ? raw : DEFAULT_AGENT_MODEL;
}

export function resolveAnthropicUtilityModel(): string {
  const raw = process.env.ANTHROPIC_UTILITY_MODEL;
  return raw && raw.length > 0 ? raw : DEFAULT_UTILITY_MODEL;
}
