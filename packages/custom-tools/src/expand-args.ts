import { holoError, ErrorCode } from '@holo/errors';

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const ESCAPED_OPEN = ' ESCOPEN ';
const ESCAPED_CLOSE = ' ESCCLOSE ';

export function expandArgs(
  template: readonly string[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  return template.map((part) => {
    // Handle the {{{{ ... }}}} literal escape: temporarily replace the doubled
    // braces with sentinels so the placeholder regex doesn't match them.
    const protectedPart = part
      .replace(/\{\{\{\{/g, ESCAPED_OPEN)
      .replace(/\}\}\}\}/g, ESCAPED_CLOSE);

    // Detect any remaining unbalanced `{{` or `}}` after placeholders.
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

    if (expanded.includes('{{') || expanded.includes('}}')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Malformed template fragment: ${part}`,
        fix: 'Use {{name}} for placeholders or {{{{ }}}} for literal braces.',
      });
    }

    return expanded
      .replace(new RegExp(ESCAPED_OPEN, 'g'), '{{')
      .replace(new RegExp(ESCAPED_CLOSE, 'g'), '}}');
  });
}
