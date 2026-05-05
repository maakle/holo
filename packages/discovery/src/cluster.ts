// packages/discovery/src/cluster.ts
import type { ArtifactInput, ClusterOptions, Episode } from './types.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string) { if (!this.parent.has(id)) this.parent.set(id, id); }
  find(id: string): string {
    const p = this.parent.get(id) ?? id;
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function withinWindow(a: Date, b: Date, ms: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= ms;
}

export function clusterArtifacts(
  artifacts: ArtifactInput[],
  opts: ClusterOptions,
): Episode[] {
  const uf = new UnionFind();
  for (const a of artifacts) uf.add(a.id);

  const byHint = new Map<string, ArtifactInput[]>();
  for (const a of artifacts) {
    for (const h of a.entityHints) {
      const list = byHint.get(h) ?? [];
      list.push(a);
      byHint.set(h, list);
    }
  }
  for (const list of byHint.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ai = list[i]!;
        const aj = list[j]!;
        if (withinWindow(ai.fetchedAt, aj.fetchedAt, opts.timeWindowMs)) {
          uf.union(ai.id, aj.id);
        }
      }
    }
  }

  for (let i = 0; i < artifacts.length; i++) {
    for (let j = i + 1; j < artifacts.length; j++) {
      const ai = artifacts[i]!;
      const aj = artifacts[j]!;
      if (!ai.embedding || !aj.embedding) continue;
      if (!withinWindow(ai.fetchedAt, aj.fetchedAt, opts.timeWindowMs)) continue;
      if (cosine(ai.embedding, aj.embedding) >= opts.similarityThreshold) {
        uf.union(ai.id, aj.id);
      }
    }
  }

  const groups = new Map<string, ArtifactInput[]>();
  for (const a of artifacts) {
    const root = uf.find(a.id);
    const list = groups.get(root) ?? [];
    list.push(a);
    groups.set(root, list);
  }

  const episodes: Episode[] = [];
  for (const list of groups.values()) {
    if (list.length < opts.minArtifacts) continue;
    const distinctSources = new Set(list.map((a) => a.sourceId));
    if (distinctSources.size < opts.minDistinctSources) continue;

    const sorted = list.slice().sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
    const dim = sorted.find((a) => a.embedding)?.embedding?.length ?? 1024;
    const centroid = new Array<number>(dim).fill(0);
    let counted = 0;
    for (const a of sorted) {
      if (!a.embedding) continue;
      for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] ?? 0) + (a.embedding[i] ?? 0);
      counted++;
    }
    if (counted > 0) for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] ?? 0) / counted;

    const hintCounts = new Map<string, number>();
    for (const a of sorted) for (const h of a.entityHints) hintCounts.set(h, (hintCounts.get(h) ?? 0) + 1);
    let entityKey: string | null = null;
    let bestCount = 0;
    for (const [k, v] of hintCounts) if (v > bestCount) { entityKey = k; bestCount = v; }

    episodes.push({
      artifactIds: sorted.map((a) => a.id),
      centroidEmbedding: centroid,
      entityKey,
      firstSeenAt: sorted[0]!.fetchedAt,
      lastSeenAt: sorted.at(-1)!.fetchedAt,
    });
  }

  return episodes;
}
