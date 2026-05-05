import { eq, and, gte, desc } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { DiscoveryDb } from '@holo/discovery';

const ID_HINT_REGEX = /\b([a-z]{3,12}[-_:]?[a-zA-Z0-9]{6,40})\b/g;

function extractHints(payload: Record<string, unknown>): string[] {
  const hints = new Set<string>();
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string') continue;
    const matches = v.match(ID_HINT_REGEX);
    if (matches) for (const m of matches) hints.add(`${k}:${m}`);
  }
  return Array.from(hints).slice(0, 8);
}

export function buildDiscoveryDb(db: DB): DiscoveryDb {
  return {
    async recentArtifactsForOrg(orgId, windowMs) {
      const since = new Date(Date.now() - windowMs);
      const rows = await db
        .select({
          id: schema.sourceArtifacts.id,
          sourceId: schema.sourceArtifacts.sourceId,
          externalId: schema.sourceArtifacts.externalId,
          kind: schema.sourceArtifacts.kind,
          payload: schema.sourceArtifacts.payload,
          fetchedAt: schema.sourceArtifacts.fetchedAt,
          embedding: schema.chunks.embedding,
          chunkContent: schema.chunks.content,
        })
        .from(schema.sourceArtifacts)
        .leftJoin(schema.chunks, eq(schema.chunks.sourceArtifactId, schema.sourceArtifacts.id))
        .where(
          and(
            eq(schema.sourceArtifacts.organizationId, orgId),
            gte(schema.sourceArtifacts.fetchedAt, since),
          ),
        )
        .orderBy(desc(schema.sourceArtifacts.fetchedAt))
        .limit(2000);

      // Dedupe by artifact id, keeping the chunk with the longest content (best embedding signal).
      const byId = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const existing = byId.get(r.id);
        if (!existing || (r.chunkContent?.length ?? 0) > (existing.chunkContent?.length ?? 0)) {
          byId.set(r.id, r);
        }
      }

      return Array.from(byId.values()).map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        externalId: r.externalId,
        kind: r.kind,
        payload: r.payload as Record<string, unknown>,
        fetchedAt: r.fetchedAt,
        embedding: (r.embedding as number[] | null) ?? null,
        entityHints: extractHints(r.payload as Record<string, unknown>),
      }));
    },

    async recentRejectedCentroidsForOrg(orgId, lookbackMs) {
      const since = new Date(Date.now() - lookbackMs);
      const rows = await db
        .select({ centroid: schema.procedureEpisodes.centroidEmbedding })
        .from(schema.procedureProposals)
        .innerJoin(
          schema.procedureEpisodes,
          eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
        )
        .where(
          and(
            eq(schema.procedureProposals.organizationId, orgId),
            eq(schema.procedureProposals.status, 'rejected'),
            gte(schema.procedureProposals.createdAt, since),
          ),
        );
      return rows
        .map((r) => (r.centroid as number[] | null) ?? [])
        .filter((v) => v.length > 0);
    },

    async insertEpisode(orgId, episode) {
      const [row] = await db
        .insert(schema.procedureEpisodes)
        .values({
          organizationId: orgId,
          sourceArtifactIds: episode.artifactIds,
          centroidEmbedding: episode.centroidEmbedding,
          entityKey: episode.entityKey,
          firstSeenAt: episode.firstSeenAt,
          lastSeenAt: episode.lastSeenAt,
        })
        .returning({ id: schema.procedureEpisodes.id });
      return row!.id;
    },

    async insertProposal(orgId, episodeId, proposal) {
      const [row] = await db
        .insert(schema.procedureProposals)
        .values({
          organizationId: orgId,
          episodeId,
          proposedSlug: proposal.proposedSlug,
          proposedName: proposal.proposedName,
          summary: proposal.summary,
        })
        .returning({ id: schema.procedureProposals.id });
      return row!.id;
    },
  };
}
