import type { SyntaxNode } from 'tree-sitter';
import { recursiveSplit } from '../recursive-split';

export type { SyntaxNode } from 'tree-sitter';
export { createRegistry } from './registry';
export type { TreeSitterRegistry } from './registry';

export interface AstChunk {
  content: string;
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed, inclusive
  symbolName?: string;
}

// ---------------------------------------------------------------------------
// Symbol node types (union across all supported languages)
// ---------------------------------------------------------------------------
const SYMBOL_TYPES = new Set([
  // JS / TS / TSX
  'function_declaration',
  'class_declaration',
  'method_definition',
  'lexical_declaration',
  'export_statement',
  // Python
  'function_definition',
  'class_definition',
  'decorated_definition',
  // Go
  'method_declaration',
  'type_declaration',
  // Rust
  'function_item',
  'impl_item',
  'struct_item',
  'enum_item',
  'trait_item',
  // Java
  'interface_declaration',
  'method_declaration',
  // Ruby
  'method',
  'class',
  'module',
  // PHP
  // 'function_definition' already above, 'class_declaration' already above
  // 'method_declaration' already above
  // C / C++
  'function_definition',  // already above
  'class_specifier',
  'struct_specifier',
  'namespace_definition',
]);

// For JS/TS lexical_declaration: only treat as symbol if the initializer is an
// arrow function or function expression. We use a loose heuristic: check if any
// descendant named "arrow_function" or "function" exists at depth ≤ 2.
function isSymbolLexicalDecl(node: SyntaxNode): boolean {
  for (const child of node.children) {
    for (const grand of child.children) {
      if (
        grand.type === 'arrow_function' ||
        grand.type === 'function' ||
        grand.type === 'function_expression'
      ) {
        return true;
      }
    }
  }
  return false;
}

function isSymbolNode(node: SyntaxNode): boolean {
  if (!SYMBOL_TYPES.has(node.type)) return false;
  if (node.type === 'lexical_declaration') return isSymbolLexicalDecl(node);
  return true;
}

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Try to get a human-readable symbol name from a node. */
function symbolName(node: SyntaxNode): string | undefined {
  // For export_statement wrapping a declaration, dig into the child declaration
  if (node.type === 'export_statement') {
    for (const child of node.children) {
      if (isSymbolNode(child)) {
        return symbolName(child);
      }
    }
    return undefined;
  }

  // For decorated_definition (Python), dig into the actual definition
  if (node.type === 'decorated_definition') {
    for (const child of node.children) {
      if (
        child.type === 'function_definition' ||
        child.type === 'class_definition'
      ) {
        return symbolName(child);
      }
    }
    return undefined;
  }

  // For lexical_declaration: look for the variable_declarator's name
  if (node.type === 'lexical_declaration') {
    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        return nameNode?.text;
      }
    }
  }

  // Standard: look for 'name' field
  return node.childForFieldName('name')?.text;
}

/**
 * Split `node` (program root) into AstChunks guided by top-level symbol nodes.
 */
export function astChunk(
  node: SyntaxNode,
  opts: { maxTokens: number; overlap: number },
): AstChunk[] {
  const { maxTokens, overlap } = opts;
  const overlapChars = overlap * 4;

  const result: AstChunk[] = [];

  // Accumulate preamble (non-symbol) top-level nodes
  let preambleLines: string[] = [];
  let preambleStart: number | null = null;
  let preambleEnd = 0;

  function flushPreamble(): void {
    if (preambleLines.length === 0 || preambleStart === null) return;
    const content = preambleLines.join('\n');
    if (content.trim().length > 0) {
      result.push({
        content,
        startLine: preambleStart,
        endLine: preambleEnd,
      });
    }
    preambleLines = [];
    preambleStart = null;
  }

  function emitChunk(chunk: AstChunk): void {
    result.push(chunk);
  }

  function processSymbol(symNode: SyntaxNode): void {
    const text = symNode.text;
    const startLine = symNode.startPosition.row + 1;
    const endLine = symNode.endPosition.row + 1;
    const name = symbolName(symNode);

    if (tokens(text) <= maxTokens) {
      emitChunk({ content: text, startLine, endLine, symbolName: name });
      return;
    }

    // Oversized: try to recurse into body children
    // Find a body/block child (class_body, block, etc.)
    const bodyNode =
      symNode.childForFieldName('body') ??
      symNode.childForFieldName('block') ??
      null;

    if (bodyNode !== null) {
      // Collect symbol children from the body
      const symbolChildren: SyntaxNode[] = [];
      for (const child of bodyNode.children) {
        if (isSymbolNode(child)) {
          symbolChildren.push(child);
        }
      }

      if (symbolChildren.length > 0) {
        // Recursively process each sub-symbol
        for (const child of symbolChildren) {
          processSymbol(child);
        }
        return;
      }
    }

    // Fallback: character-level split
    const parts = recursiveSplit(text, {
      chunkSize: maxTokens * 4,
      overlap: overlapChars,
    });
    for (const part of parts) {
      // approximate line numbers: find offset into original text
      const offset = text.indexOf(part);
      let partStart = startLine;
      let partEnd = endLine;
      if (offset !== -1) {
        const before = text.slice(0, offset);
        const newlinesBefore = (before.match(/\n/g) ?? []).length;
        partStart = startLine + newlinesBefore;
        const partLines = (part.match(/\n/g) ?? []).length;
        partEnd = partStart + partLines;
      }
      emitChunk({ content: part, startLine: partStart, endLine: partEnd, symbolName: name });
    }
  }

  // Pass 1: collect top-level structure
  interface TopLevel {
    kind: 'preamble' | 'symbol';
    node: SyntaxNode;
  }
  const topLevel: TopLevel[] = [];

  for (const child of node.children) {
    if (child.type === 'comment' || child.type === 'ERROR') {
      topLevel.push({ kind: 'preamble', node: child });
    } else if (isSymbolNode(child)) {
      topLevel.push({ kind: 'symbol', node: child });
    } else {
      topLevel.push({ kind: 'preamble', node: child });
    }
  }

  // Pass 2: accumulate preamble, emit symbols
  for (const item of topLevel) {
    if (item.kind === 'preamble') {
      const line = item.node.startPosition.row + 1;
      const endL = item.node.endPosition.row + 1;
      if (preambleStart === null) preambleStart = line;
      preambleEnd = endL;
      // Split into lines (in case the node spans multiple lines)
      const nodeLines = item.node.text.split('\n');
      preambleLines.push(...nodeLines);

      // Flush if preamble is getting too large
      if (tokens(preambleLines.join('\n')) > maxTokens) {
        flushPreamble();
      }
    } else {
      // Flush any accumulated preamble before a symbol
      flushPreamble();
      processSymbol(item.node);
      // Note: we do NOT apply overlap across distinct top-level symbols
    }
  }

  // Flush remaining preamble
  flushPreamble();

  return result;
}
