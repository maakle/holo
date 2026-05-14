/**
 * Per-kind renderers — turn an artifact's chunks into a single markdown
 * blob suitable for `cat`. RFC 0009.
 *
 * The current chunkers already emit markdown-friendly text in
 * `chunks.content`, so the default renderer is "join chunks in order with
 * a separator." Per-kind overrides exist where that produces obviously
 * wrong output (e.g. a Notion page emits one chunk per block + a summary
 * chunk; we want body-first).
 */

export interface ChunkLike {
  kind: string;
  content: string;
  metadata: Record<string, unknown> | null;
  /** Ingest order within the artifact. */
  createdAt: Date | string;
}

export interface RenderedFile {
  content: string;
  /** Chunks that the caller passed in but which were filtered (e.g. an
   * ACL re-check at the chunk level). The renderer surfaces a marker
   * `[redacted N chunk(s)]` at the end of the output so users notice. */
  redactedChunkCount: number;
}

interface Renderer {
  render(chunks: ChunkLike[]): string;
}

const defaultRenderer: Renderer = {
  render(chunks) {
    return chunks
      .map((c) => c.content.trimEnd())
      .filter((s) => s.length > 0)
      .join('\n\n---\n\n');
  },
};

// Notion block-type → Markdown. The page-summary chunk is a retrieval signal,
// not a human view; we drop it and render block chunks only.
function notionBlockToMarkdown(blockType: string, text: string): string {
  switch (blockType) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `- [ ] ${text}`;
    case 'quote':
    case 'callout':
      return `> ${text}`;
    case 'code':
      return '```\n' + text + '\n```';
    case 'divider':
      return '---';
    case 'table_of_contents':
      return '';
    default:
      return text;
  }
}

function extractNotionBlock(chunk: ChunkLike): { type: string; text: string } | null {
  // Block-chunk content is `${breadcrumb} / ${type}\n${text}` — strip the header.
  const newlineIdx = chunk.content.indexOf('\n');
  if (newlineIdx === -1) return null;
  const header = chunk.content.slice(0, newlineIdx);
  const text = chunk.content.slice(newlineIdx + 1).trimEnd();
  const metaType = chunk.metadata?.block_type;
  const type = typeof metaType === 'string'
    ? metaType
    : (header.split(' / ').pop() ?? '');
  return { type, text };
}

const notionRenderer: Renderer = {
  render(chunks) {
    const blocks = chunks.filter(
      (c) => (c.metadata?.kind ?? c.metadata?.chunk_kind) !== 'page',
    );
    return blocks
      .map((c) => {
        const parsed = extractNotionBlock(c);
        if (!parsed) return c.content.trimEnd();
        return notionBlockToMarkdown(parsed.type, parsed.text);
      })
      .filter((s) => s.length > 0)
      .join('\n\n');
  },
};

/** Grain: summary chunk first, then transcript chunks ordered by chunk_index. */
const grainRenderer: Renderer = {
  render(chunks) {
    const summary = chunks.filter((c) => c.metadata?.chunk_kind === 'summary');
    const transcripts = chunks
      .filter((c) => c.metadata?.chunk_kind === 'transcript')
      .sort((a, b) => {
        const ai = Number(a.metadata?.chunk_index ?? 0);
        const bi = Number(b.metadata?.chunk_index ?? 0);
        return ai - bi;
      });
    return [...summary, ...transcripts]
      .map((c) => c.content.trimEnd())
      .filter((s) => s.length > 0)
      .join('\n\n');
  },
};

/** GitHub PR: title, then diff, then review threads. */
const githubPrRenderer: Renderer = {
  render(chunks) {
    const order = ['title', 'diff', 'review'];
    const ranked = [...chunks].sort((a, b) => {
      const ai = order.indexOf(String(a.metadata?.kind ?? ''));
      const bi = order.indexOf(String(b.metadata?.kind ?? ''));
      const av = ai === -1 ? order.length : ai;
      const bv = bi === -1 ? order.length : bi;
      return av - bv;
    });
    return ranked
      .map((c) => c.content.trimEnd())
      .filter((s) => s.length > 0)
      .join('\n\n');
  },
};

// Several doc-style chunkers prepend a fixed header (breadcrumb / title / URL)
// to every chunk's content for retrieval matching. When the artifact is
// rendered for a human, we want that header once at the top, not N times.
// This renderer finds the longest line-prefix shared by every chunk, emits
// it once, then joins the remaining bodies.
const headerDedupRenderer: Renderer = {
  render(chunks) {
    const contents = chunks.map((c) => c.content).filter((s) => s.length > 0);
    if (contents.length === 0) return '';
    if (contents.length === 1) return contents[0]!.trimEnd();

    const firstLines = contents[0]!.split('\n');
    let commonLineCount = 0;
    for (let i = 0; i < firstLines.length; i++) {
      const candidate = firstLines.slice(0, i + 1).join('\n');
      const allMatch = contents.every(
        (c) => c === candidate || c.startsWith(candidate + '\n'),
      );
      if (allMatch) commonLineCount = i + 1;
      else break;
    }

    const header = firstLines.slice(0, commonLineCount).join('\n').trim();
    const bodies = contents
      .map((c) => c.split('\n').slice(commonLineCount).join('\n').trim())
      .filter((s) => s.length > 0);

    const joined = bodies.join('\n\n---\n\n');
    return header.length > 0 ? `${header}\n\n${joined}` : joined;
  },
};

const renderers: Record<string, Renderer> = {
  'notion-page': notionRenderer,
  'grain-call': grainRenderer,
  'github-pr': githubPrRenderer,
  'github-doc': headerDedupRenderer,
  'mintlify-page': headerDedupRenderer,
  'prismic-document': headerDedupRenderer,
  'webcrawl-page': headerDedupRenderer,
  'zendesk-article': headerDedupRenderer,
};

export function renderArtifact(
  kind: string,
  chunks: ChunkLike[],
  totalChunkCount: number,
): RenderedFile {
  const renderer = renderers[kind] ?? defaultRenderer;
  const body = renderer.render(chunks);
  const redactedChunkCount = Math.max(0, totalChunkCount - chunks.length);
  const content = redactedChunkCount > 0
    ? `${body}\n\n[redacted ${redactedChunkCount} chunk(s) — insufficient permissions]`
    : body;
  return { content, redactedChunkCount };
}
