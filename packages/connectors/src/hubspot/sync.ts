import {
  hubspotRecordChunker,
  type HubspotRecordInput,
  type HubspotRecordType,
} from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import type {
  HubspotApiClient,
  HubspotEngagement,
  HubspotObjectType,
  HubspotRecord,
} from './api-client';

export type HubspotChunkKind =
  | 'hubspot-contact'
  | 'hubspot-deal'
  | 'hubspot-company'
  | 'hubspot-engagement';

export type HubspotChunkPayload = {
  kind: HubspotChunkKind;
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'hubspot';
  sourceId: string;
  organizationId: string;
};

export type HubspotEmbedEnqueueFn = (payload: {
  recordId: string;
  recordType: HubspotRecordType;
  chunks: HubspotChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

const OBJECT_TO_RECORD_TYPE: Record<HubspotObjectType, HubspotRecordType> = {
  contacts: 'contact',
  deals: 'deal',
  companies: 'company',
};

const RECORD_TYPE_TO_KIND: Record<HubspotRecordType, HubspotChunkKind> = {
  contact: 'hubspot-contact',
  deal: 'hubspot-deal',
  company: 'hubspot-company',
};

export interface HubspotCursor {
  /** ISO timestamps per object type. Missing = full sweep on first run. */
  contacts?: string;
  deals?: string;
  companies?: string;
}

export interface RunHubspotSyncInput {
  client: HubspotApiClient;
  cursor: HubspotCursor;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: HubspotEmbedEnqueueFn;
  logger?: { warn(msg: string): void };
  /** Restrict which object types to sync. Defaults to all three. */
  objectTypes?: HubspotObjectType[];
}

export interface RunHubspotSyncOutput {
  artifactCount: number;
  /** Watermarks the sync layer should persist back into the cursor. */
  newCursor: HubspotCursor;
}

const DEFAULT_OBJECT_TYPES: HubspotObjectType[] = ['contacts', 'deals', 'companies'];

function deriveDisplayName(
  recordType: HubspotRecordType,
  props: Record<string, string | null>,
): string {
  if (recordType === 'contact') {
    const first = props['firstname'] ?? '';
    const last = props['lastname'] ?? '';
    const joined = `${first} ${last}`.trim();
    if (joined) return joined;
    if (props['email']) return props['email'] as string;
    return 'Contact';
  }
  if (recordType === 'deal') {
    return (props['dealname'] as string) || 'Deal';
  }
  return (props['name'] as string) || (props['domain'] as string) || 'Company';
}

function propsToInput(
  props: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

function mapEngagement(e: HubspotEngagement): HubspotRecordInput['engagements'][number] {
  return {
    id: e.id,
    type: e.engagementType,
    createdAt: new Date(e.createdAt),
    body: e.body,
    subject: e.subject,
    ownerName: e.ownerId,
    callOutcome: e.callOutcome,
    callDurationSec: e.callDurationSec,
  };
}

export async function runHubspotSync(
  input: RunHubspotSyncInput,
): Promise<RunHubspotSyncOutput> {
  const logger = input.logger ?? { warn: () => {} };
  const newCursor: HubspotCursor = { ...input.cursor };
  const objectTypes = input.objectTypes ?? DEFAULT_OBJECT_TYPES;
  let totalArtifacts = 0;

  for (const objectType of objectTypes) {
    const recordType = OBJECT_TO_RECORD_TYPE[objectType];
    const recordKind = RECORD_TYPE_TO_KIND[recordType];
    let after: string | undefined;
    let latestUpdatedAt: string | undefined = input.cursor[objectType];

    do {
      let page: { results: HubspotRecord[]; nextAfter?: string };
      try {
        page = await input.client.listRecords(objectType, {
          updatedAfter: input.cursor[objectType],
          after,
        });
      } catch (err) {
        logger.warn(
          `hubspot: ${objectType} list failed: ${(err as Error).message}; skipping object type`,
        );
        break;
      }

      for (const record of page.results) {
        const artifactId = `hubspot-${recordType}:${record.id}`;
        const props = propsToInput(record.properties ?? {});
        const displayName = deriveDisplayName(recordType, record.properties ?? {});

        let engagements: HubspotEngagement[] = [];
        try {
          engagements = await input.client.getEngagementsForRecord(objectType, record.id);
        } catch (err) {
          logger.warn(
            `hubspot: engagements for ${artifactId} failed: ${(err as Error).message}`,
          );
        }

        const recordInput: HubspotRecordInput = {
          recordType,
          recordId: record.id,
          displayName,
          properties: props,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
          engagements: engagements.map(mapEngagement),
        };

        const rawChunks = await hubspotRecordChunker.chunk(recordInput, {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          sourceArtifactId: artifactId,
        });

        const newChunks: HubspotChunkPayload[] = [];
        for (const c of rawChunks) {
          const role = c.metadata['chunk_role'];
          const kind: HubspotChunkKind =
            role === 'engagement' ? 'hubspot-engagement' : recordKind;
          const hash = chunkHash(kind, c.content);
          if (input.existingHashes.has(hash)) continue;
          input.existingHashes.add(hash);
          newChunks.push({
            kind,
            content: c.content,
            metadata: c.metadata,
            aclSubjects: c.aclSubjects,
            contentHash: hash,
            sourceArtifactId: artifactId,
            provider: 'hubspot',
            sourceId: input.sourceId,
            organizationId: input.organizationId,
          });
        }

        if (newChunks.length > 0) {
          await input.enqueueEmbed({
            recordId: record.id,
            recordType,
            chunks: newChunks,
            organizationId: input.organizationId,
            sourceId: input.sourceId,
          });
        }

        totalArtifacts++;
        if (!latestUpdatedAt || record.updatedAt > latestUpdatedAt) {
          latestUpdatedAt = record.updatedAt;
        }
      }

      after = page.nextAfter;
    } while (after);

    if (latestUpdatedAt) {
      newCursor[objectType] = latestUpdatedAt;
    }
  }

  return { artifactCount: totalArtifacts, newCursor };
}
