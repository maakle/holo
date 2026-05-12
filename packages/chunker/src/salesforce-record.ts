import type { Chunker, Chunk, ChunkContext } from './contract';

export type SalesforceRecordType = 'account' | 'contact' | 'opportunity';
export type SalesforceActivityType = 'note' | 'call' | 'email' | 'meeting' | 'task';

export interface SalesforceActivity {
  id: string;
  type: SalesforceActivityType;
  createdAt: Date;
  body: string;
  ownerName?: string;
  subject?: string;
  callOutcome?: string;
  callDurationSec?: number;
}

export interface SalesforceRecordInput {
  recordType: SalesforceRecordType;
  recordId: string;
  /** Human-friendly title for the record (e.g. "Jane Doe", "Acme Corp"). */
  displayName: string;
  /** Stringified property bag — already trimmed by the sync layer to the salient set. */
  properties: Record<string, string | number | boolean | null | undefined>;
  createdAt: Date;
  updatedAt: Date;
  activities: SalesforceActivity[];
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatProps(props: SalesforceRecordInput['properties']): string[] {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    if (val === null || val === undefined || val === '') continue;
    lines.push(`${key}: ${String(val)}`);
  }
  return lines;
}

/**
 * Emits N+1 chunks per Salesforce record:
 *   - chunks[0] — record summary (fields)
 *   - chunks[1..N] — one chunk per activity (note / call / email / meeting / task)
 *
 * All chunks share the same `parentExternalId` so retrieval can group them.
 * The chunker tags `chunk_role` and `record_type` in metadata so the sync
 * layer can map each chunk to the right `kind` for the embed pipeline.
 */
export const salesforceRecordChunker: Chunker<SalesforceRecordInput> = {
  kind: 'salesforce-record',
  embeddingModel: 'openai-3-small',

  async chunk(input: SalesforceRecordInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `salesforce-${input.recordType}:${input.recordId}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMetadata = {
      record_type: input.recordType,
      record_id: input.recordId,
      display_name: input.displayName,
      created_at: input.createdAt.toISOString(),
      updated_at: input.updatedAt.toISOString(),
    };

    const chunks: Chunk[] = [];

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

    const sorted = [...input.activities].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (const a of sorted) {
      const lines: string[] = [
        `# ${a.subject ?? a.type} on ${input.displayName}`,
        '',
        `Type: ${a.type}`,
        `Date: ${formatDate(a.createdAt)}`,
      ];
      if (a.ownerName) lines.push(`Owner: ${a.ownerName}`);
      if (a.callOutcome) lines.push(`Outcome: ${a.callOutcome}`);
      if (typeof a.callDurationSec === 'number') {
        lines.push(`Duration: ${a.callDurationSec}s`);
      }
      lines.push('');
      lines.push(a.body.trim());

      chunks.push({
        content: lines.join('\n').trimEnd(),
        parentExternalId,
        metadata: {
          ...baseMetadata,
          chunk_role: 'activity',
          activity_id: a.id,
          activity_type: a.type,
          activity_created_at: a.createdAt.toISOString(),
        },
        aclSubjects,
      });
    }

    return chunks;
  },
};
