import type { Embedder, EmbedderRegistry, EmbeddingModelWrite } from './contract';

// Minimal chunk shape used by the router. Will be replaced by `@holo/chunker`'s
// type once Task 3.1 lands. Intentionally narrow — the router only needs
// `content` and `kind` to route.
export interface RouterChunk {
  content: string;
  kind: string;
  metadata?: Record<string, unknown>;
  aclSubjects?: string[];
}

export function getEmbedderForChunkKind(
  kind: string,
  registry: EmbedderRegistry,
): Embedder {
  return kind === 'github-code' ? registry.voyage : registry.openai;
}

export interface EmbeddedChunk<C extends RouterChunk = RouterChunk> {
  chunk: C;
  embedding: number[];
  embeddingModel: EmbeddingModelWrite;
}

export async function embedChunks<C extends RouterChunk>(
  chunks: C[],
  registry: EmbedderRegistry,
): Promise<EmbeddedChunk<C>[]> {
  if (chunks.length === 0) return [];

  const groups = new Map<string, { indices: number[]; texts: string[] }>();
  chunks.forEach((c, i) => {
    const g = groups.get(c.kind) ?? { indices: [], texts: [] };
    g.indices.push(i);
    g.texts.push(c.content);
    groups.set(c.kind, g);
  });

  const out: EmbeddedChunk<C>[] = new Array(chunks.length);
  await Promise.all(
    [...groups.entries()].map(async ([kind, { indices, texts }]) => {
      const embedder = getEmbedderForChunkKind(kind, registry);
      const vectors = await embedder.embed(texts);
      indices.forEach((origIdx, i) => {
        out[origIdx] = {
          chunk: chunks[origIdx]!,
          embedding: vectors[i]!,
          embeddingModel: embedder.model,
        };
      });
    }),
  );

  return out;
}
