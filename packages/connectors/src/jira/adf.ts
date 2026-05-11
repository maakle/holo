type AdfNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
};

function isObject(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderInline(nodes: AdfNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) {
    if (!isObject(node)) continue;
    switch (node.type) {
      case 'text':
        out += typeof node.text === 'string' ? node.text : '';
        break;
      case 'hardBreak':
        out += '\n';
        break;
      case 'mention': {
        const text = node.attrs && typeof node.attrs.text === 'string' ? node.attrs.text : '';
        out += text;
        break;
      }
      case 'inlineCard':
      case 'link': {
        const url = node.attrs && typeof node.attrs.url === 'string' ? node.attrs.url : '';
        out += url;
        break;
      }
      case 'emoji': {
        const shortName =
          node.attrs && typeof node.attrs.shortName === 'string' ? node.attrs.shortName : '';
        out += shortName;
        break;
      }
      default:
        // Unknown inline node — recurse so nested text still surfaces.
        out += renderInline(node.content);
    }
  }
  return out;
}

function renderListItems(items: AdfNode[] | undefined, ordered: boolean): string {
  if (!items) return '';
  const lines: string[] = [];
  let idx = 0;
  for (const item of items) {
    if (!isObject(item) || item.type !== 'listItem') continue;
    idx += 1;
    const prefix = ordered ? `${idx}. ` : '- ';
    const body = renderBlocks(item.content).trim();
    if (body.length === 0) continue;
    // Indent secondary lines so multi-paragraph list items stay grouped.
    const indented = body.split('\n').join('\n  ');
    lines.push(`${prefix}${indented}`);
  }
  return lines.join('\n');
}

function renderBlocks(nodes: AdfNode[] | undefined): string {
  if (!nodes) return '';
  const blocks: string[] = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    switch (node.type) {
      case 'paragraph': {
        const text = renderInline(node.content);
        if (text.length > 0) blocks.push(text);
        break;
      }
      case 'heading': {
        const level =
          node.attrs && typeof node.attrs.level === 'number'
            ? Math.min(Math.max(node.attrs.level, 1), 6)
            : 1;
        const text = renderInline(node.content);
        if (text.length > 0) blocks.push(`${'#'.repeat(level)} ${text}`);
        break;
      }
      case 'bulletList':
        blocks.push(renderListItems(node.content, false));
        break;
      case 'orderedList':
        blocks.push(renderListItems(node.content, true));
        break;
      case 'codeBlock': {
        const language =
          node.attrs && typeof node.attrs.language === 'string' ? node.attrs.language : '';
        const text = renderInline(node.content);
        blocks.push(`\`\`\`${language}\n${text}\n\`\`\``);
        break;
      }
      case 'blockquote': {
        const inner = renderBlocks(node.content).trim();
        if (inner.length > 0) {
          blocks.push(
            inner
              .split('\n')
              .map((line) => (line.length > 0 ? `> ${line}` : '>'))
              .join('\n'),
          );
        }
        break;
      }
      case 'rule':
        blocks.push('---');
        break;
      case 'mediaSingle':
      case 'mediaGroup': {
        // Walk one level in to find a `media` child for the alt.
        const inner = node.content?.find((c) => isObject(c) && c.type === 'media');
        const alt =
          inner && isObject(inner) && inner.attrs && typeof inner.attrs.alt === 'string'
            ? inner.attrs.alt
            : '';
        blocks.push(`[image${alt ? `: ${alt}` : ''}]`);
        break;
      }
      case 'media': {
        const alt =
          node.attrs && typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
        blocks.push(`[image${alt ? `: ${alt}` : ''}]`);
        break;
      }
      case 'table':
        blocks.push('[table]');
        break;
      case 'panel':
      case 'expand': {
        const inner = renderBlocks(node.content).trim();
        if (inner.length > 0) blocks.push(inner);
        break;
      }
      default: {
        // Unknown block — recurse so the text inside isn't dropped.
        // Try block rendering first; fall back to inline rendering (e.g. when
        // an unknown node wraps raw text/inline nodes directly).
        const inner = renderBlocks(node.content) || renderInline(node.content);
        if (inner.length > 0) blocks.push(inner);
      }
    }
  }
  return blocks.filter((b) => b.length > 0).join('\n\n');
}

/**
 * Best-effort plain-text rendering of an Atlassian Document Format tree.
 * Unknown node types fall back to recursing into `content`, so future
 * Atlassian additions degrade gracefully rather than silently dropping text.
 * Returns '' for null / non-object input.
 */
export function adfToPlainText(doc: unknown): string {
  if (!isObject(doc)) return '';
  return renderBlocks(doc.content).trim();
}
