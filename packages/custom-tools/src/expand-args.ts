import { holoError, ErrorCode } from '@holo/errors';

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const ESCAPED_OPEN = ' ESCOPEN ';
const ESCAPED_CLOSE = ' ESCCLOSE ';

export function expandArgs(
  template: readonly string[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  return template.map((part) => {
    const protectedPart = part
      .replace(/\{\{\{\{/g, ESCAPED_OPEN)
      .replace(/\}\}\}\}/g, ESCAPED_CLOSE);

    // Malformed-brace check: any `{{` or `}}` that isn't a valid placeholder
    // and isn't a literal-escape sentinel is malformed. Compute residue first.
    const residue = protectedPart.replace(PLACEHOLDER, '');
    if (residue.includes('{{') || residue.includes('}}')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Malformed template fragment: ${part}`,
        fix: 'Use {{name}} for placeholders or {{{{ }}}} for literal braces.',
      });
    }

    const expanded = protectedPart.replace(PLACEHOLDER, (_match, name: string) => {
      if (!(name in values)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Template placeholder {{${name}}} has no provided value`,
          fix: `Pass a value for "${name}" in the tool call arguments.`,
        });
      }
      return String(values[name]);
    });

    return expanded
      .replaceAll(ESCAPED_OPEN, '{{')
      .replaceAll(ESCAPED_CLOSE, '}}');
  });
}
