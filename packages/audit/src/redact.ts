/**
 * Recursive redactor for agent event payloads. Walks an object and replaces
 * sensitive keys + secret-shaped string values with the literal '[REDACTED]'
 * before the row hits the database.
 *
 * This is intentionally conservative — false positives (over-redaction) cost
 * us a debugging session, false negatives cost the user a leak. When in
 * doubt, redact. Reserved for the write site of @holo/audit's
 * recordAgentEvent so callers don't have to remember.
 */

const SENSITIVE_KEY_PATTERN =
  /(^|_|-|\.)(authorization|cookie|set[-_]?cookie|password|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|bearer|secret|client[_-]?secret|private[_-]?key|signing[_-]?secret|webhook[_-]?secret|encryption[_-]?key)$/i;

// Common secret-shaped values seen in the wild. Each match swaps the entire
// string for '[REDACTED]' rather than only the matched span — partial leaks
// of a secret are still useful to an attacker.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/i, // Bearer tokens
  /\bsk-[A-Za-z0-9_\-]{16,}\b/, // OpenAI / Anthropic style
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, // JWT
];

const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;
const MAX_STRING_LEN = 4096;

export function redactSensitive<T>(value: T): T {
  return redactInner(value, 0) as T;
}

function redactInner(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactInner(v, depth + 1);
  }
  return out;
}

function redactString(s: string): string {
  // Truncate pathologically long strings so we never DoS the redactor.
  const candidate = s.length > MAX_STRING_LEN ? s.slice(0, MAX_STRING_LEN) : s;
  for (const re of SECRET_VALUE_PATTERNS) {
    if (re.test(candidate)) return REDACTED;
  }
  return s;
}
