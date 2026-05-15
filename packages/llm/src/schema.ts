/**
 * Anthropic's tool API requires `type: "object"` at the root of `input_schema`
 * AND rejects `anyOf` / `oneOf` / `allOf` at the top level. Zod's
 * `z.toJSONSchema` emits exactly those for unions and refined objects (custom
 * tools, `get_skill`, …), so we flatten the branches into a merged
 * `properties` map before sending. The runtime tool runner still validates
 * via the original zod schema, so the merged properties just need to be a
 * superset of the legal shapes — accepted by Anthropic, ignored by the tool
 * runner.
 *
 * Applied by both `AnthropicLLMClient` (raw SDK path) and the
 * `@ai-sdk/anthropic` adapter inside `VercelAILLMClient`, because both
 * ultimately call the same Anthropic Messages API.
 */
export function flattenForAnthropic(raw: unknown): Record<string, unknown> {
  const schema = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const branches =
    (schema['anyOf'] as unknown) ??
    (schema['oneOf'] as unknown) ??
    (schema['allOf'] as unknown);

  if (Array.isArray(branches)) {
    const properties: Record<string, unknown> = {};
    for (const branch of branches) {
      if (branch && typeof branch === 'object') {
        const branchProps = (branch as { properties?: Record<string, unknown> }).properties;
        if (branchProps) Object.assign(properties, branchProps);
      }
    }
    const { anyOf: _a, oneOf: _o, allOf: _al, type: _t, properties: _p, ...rest } = schema;
    return { ...rest, type: 'object', properties };
  }

  if (schema['type'] === 'object') return schema;
  return { type: 'object', ...schema };
}
