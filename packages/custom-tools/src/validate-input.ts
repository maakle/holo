import AjvModule, { type ErrorObject } from 'ajv';
import { holoError, ErrorCode } from '@holo/errors';

// Ajv 8.x default-export interop under ESM
const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;

const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: false });

export function validateInput(
  schema: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> {
  const validate = ajv.compile(schema);
  if (!validate(input)) {
    const errs = (validate.errors ?? []).map(formatErr).join('; ');
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Tool input failed schema validation: ${errs}`,
      fix: 'Check the tool inputSchema and adjust the arguments.',
    });
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Tool input must be a JSON object',
      fix: 'Pass an object, not null/array/scalar.',
    });
  }
  return input as Record<string, unknown>;
}

function formatErr(e: ErrorObject): string {
  return `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim();
}
