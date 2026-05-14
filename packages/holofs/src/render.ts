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

/** Notion: page-level summary first if present, then blocks in insert order. */
const notionRenderer: Renderer = {
  render(chunks) {
    const summary = chunks.filter((c) => (c.metadata?.kind ?? c.metadata?.chunk_kind) === 'page');
    const blocks = chunks.filter((c) => (c.metadata?.kind ?? c.metadata?.chunk_kind) !== 'page');
    return [...summary, ...blocks]
      .map((c) => c.content.trimEnd())
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

const renderers: Record<string, Renderer> = {
  'notion-page': notionRenderer,
  'grain-call': grainRenderer,
  'github-pr': githubPrRenderer,
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
