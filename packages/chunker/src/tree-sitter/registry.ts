import Parser from 'tree-sitter';

// Re-export the SyntaxNode type for consumers
export type { SyntaxNode } from 'tree-sitter';

export interface TreeSitterRegistry {
  parse(language: string, source: string): Promise<Parser.SyntaxNode | null>;
}

// Each grammar package exports either:
//   { name, language, nodeTypeInfo }  -- most grammars (Python, JS, Go, etc.)
//   { typescript: {...}, tsx: {...} }  -- tree-sitter-typescript
//   { php: {...}, php_only: {...} }    -- tree-sitter-php
//
// tree-sitter's setLanguage() accepts the whole wrapper object (not the raw
// .language External), because it needs nodeTypeInfo to build nodeSubclasses
// and the wrapper object must be extensible (not the raw External).

const loaders: Record<string, () => Promise<unknown>> = {
  typescript: async () => {
    const m = await import('tree-sitter-typescript');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (m as any).default ?? m;
    // exports: { typescript: { name, language, nodeTypeInfo }, tsx: {...} }
    return mod.typescript;
  },
  tsx: async () => {
    const m = await import('tree-sitter-typescript');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (m as any).default ?? m;
    return mod.tsx;
  },
  javascript: async () => {
    const m = await import('tree-sitter-javascript');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  python: async () => {
    const m = await import('tree-sitter-python');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  go: async () => {
    const m = await import('tree-sitter-go');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  rust: async () => {
    const m = await import('tree-sitter-rust');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  java: async () => {
    const m = await import('tree-sitter-java');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  ruby: async () => {
    const m = await import('tree-sitter-ruby');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  php: async () => {
    const m = await import('tree-sitter-php');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (m as any).default ?? m;
    // exports: { php: { name, language, nodeTypeInfo }, php_only: {...} }
    return mod.php;
  },
  c: async () => {
    const m = await import('tree-sitter-c');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
  cpp: async () => {
    const m = await import('tree-sitter-cpp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (m as any).default ?? m;
  },
};

export function createRegistry(): TreeSitterRegistry {
  // Cache: language slug → Parser instance (already configured with its language)
  const cache = new Map<string, Parser>();

  async function getParser(language: string): Promise<Parser | null> {
    const cached = cache.get(language);
    if (cached !== undefined) return cached;

    const loader = loaders[language];
    if (loader === undefined) return null;

    const lang = await loader();
    const parser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.setLanguage(lang as any);
    cache.set(language, parser);
    return parser;
  }

  return {
    async parse(language: string, source: string): Promise<Parser.SyntaxNode | null> {
      const parser = await getParser(language);
      if (parser === null) return null;
      const tree = parser.parse(source);
      return tree.rootNode;
    },
  };
}
