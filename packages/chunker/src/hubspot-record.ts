import type { Chunker, Chunk, ChunkContext } from './contract';

export type HubspotRecordType = 'contact' | 'deal' | 'company';
export type HubspotEngagementType = 'note' | 'call' | 'email' | 'meeting' | 'task';

export interface HubspotEngagement {
  id: string;
  type: HubspotEngagementType;
  createdAt: Date;
  body: string;
  ownerName?: string;
  subject?: string;
  callOutcome?: string;
  callDurationSec?: number;
}

export interface HubspotRecordInput {
  recordType: HubspotRecordType;
  recordId: string;
  /** Human-friendly title for the record (e.g. "Jane Doe", "Acme Corp"). */
  displayName: string;
  /** Stringified property bag — already trimmed by the sync layer to the salient set. */
  properties: Record<string, string | number | boolean | null | undefined>;
  createdAt: Date;
  updatedAt: Date;
  engagements: HubspotEngagement[];
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatProps(props: HubspotRecordInput['properties']): string[] {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    if (val === null || val === undefined || val === '') continue;
    lines.push(`${key}: ${String(val)}`);
  }
  return lines;
}

/**
 * Emits N+1 chunks per HubSpot record:
 *   - chunks[0] — record summary (properties)
 *   - chunks[1..N] — one chunk per engagement (note / call / email / meeting / task)
 *
 * All chunks share the same `parentExternalId` so retrieval can group them.
 * The chunker tags `chunk_role` and `record_type` in metadata so the sync
 * layer can map each chunk to the right `kind` for the embed pipeline.
 */
export const hubspotRecordChunker: Chunker<HubspotRecordInput> = {
  kind: 'hubspot-record',
  embeddingModel: 'openai-3-large',

  async chunk(input: HubspotRecordInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `hubspot-${input.recordType}:${input.recordId}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMetadata = {
      record_type: input.recordType,
      record_id: input.recordId,
      display_name: input.displayName,
      created_at: input.createdAt.toISOString(),
      updated_at: input.updatedAt.toISOString(),
    };

    const chunks: Chunk[] = [];

    // Record chunk
    const propLines = formatProps(input.properties);
    const recordLines: string[] = [
      `# ${input.displayName}`,
      '',
      `Type: ${input.recordType}`,
      `Created: ${formatDate(input.createdAt)} | Updated: ${formatDate(input.updatedAt)}`,
    ];
    if (propLines.length > 0) {
      recordLines.push('');
      recordLines.push(...propLines);
    }

    chunks.push({
      content: recordLines.join('\n').trimEnd(),
      parentExternalId,
      metadata: { ...baseMetadata, chunk_role: 'record' },
      aclSubjects,
    });

    // Engagement chunks (chronological)
    const sorted = [...input.engagements].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (const eng of sorted) {
      const lines: string[] = [
        `# ${eng.subject ?? eng.type} on ${input.displayName}`,
        '',
        `Type: ${eng.type}`,
        `Date: ${formatDate(eng.createdAt)}`,
      ];
      if (eng.ownerName) lines.push(`Owner: ${eng.ownerName}`);
      if (eng.callOutcome) lines.push(`Outcome: ${eng.callOutcome}`);
      if (typeof eng.callDurationSec === 'number') {
        lines.push(`Duration: ${eng.callDurationSec}s`);
      }
      lines.push('');
      lines.push(eng.body.trim());

      chunks.push({
        content: lines.join('\n').trimEnd(),
        parentExternalId,
        metadata: {
          ...baseMetadata,
          chunk_role: 'engagement',
          engagement_id: eng.id,
          engagement_type: eng.type,
          engagement_created_at: eng.createdAt.toISOString(),
        },
        aclSubjects,
      });
    }

    return chunks;
  },
};
