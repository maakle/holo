import { z } from 'zod';
import {
  hubspotRecordChunker,
  type HubspotRecordInput,
  type HubspotRecordType,
} from '@holo/chunker';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type HttpClient,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';

export interface HubspotSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

// ── Domain types ─────────────────────────────────────────────────────────────

type ObjectType = 'contacts' | 'deals' | 'companies';

interface HubspotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

interface HubspotEngagement {
  id: string;
  engagementType: 'note' | 'call' | 'email' | 'meeting' | 'task';
  createdAt: string;
  body: string;
  ownerId?: string;
  subject?: string;
  callOutcome?: string;
  callDurationSec?: number;
}

// ── HubSpot constants ────────────────────────────────────────────────────────

const RECORD_PROPS: Record<ObjectType, ReadonlyArray<string>> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'jobtitle',
    'company',
    'lifecyclestage',
    'hs_lead_status',
    'createdate',
    'lastmodifieddate',
  ],
  deals: [
    'dealname',
    'dealstage',
    'pipeline',
    'amount',
    'closedate',
    'dealtype',
    'hs_priority',
    'description',
    'createdate',
    'hs_lastmodifieddate',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'numberofemployees',
    'annualrevenue',
    'description',
    'lifecyclestage',
    'createdate',
    'hs_lastmodifieddate',
  ],
};

const OBJECT_TO_RECORD_TYPE: Record<ObjectType, HubspotRecordType> = {
  contacts: 'contact',
  deals: 'deal',
  companies: 'company',
};

const ENGAGEMENT_OBJECT_TYPES = ['notes', 'calls', 'emails', 'meetings', 'tasks'] as const;
type EngagementObjectType = (typeof ENGAGEMENT_OBJECT_TYPES)[number];

const ENGAGEMENT_TYPE_FOR_OBJECT: Record<EngagementObjectType, HubspotEngagement['engagementType']> = {
  notes: 'note',
  calls: 'call',
  emails: 'email',
  meetings: 'meeting',
  tasks: 'task',
};

const ENGAGEMENT_BODY_PROPERTY: Record<EngagementObjectType, string> = {
  notes: 'hs_note_body',
  calls: 'hs_call_body',
  emails: 'hs_email_text',
  meetings: 'hs_meeting_body',
  tasks: 'hs_task_body',
};

const ENGAGEMENT_PROPS: Record<EngagementObjectType, ReadonlyArray<string>> = {
  notes: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
  calls: [
    'hs_call_body',
    'hs_call_title',
    'hs_call_disposition',
    'hs_call_duration',
    'hs_timestamp',
    'hubspot_owner_id',
  ],
  emails: ['hs_email_text', 'hs_email_subject', 'hs_timestamp', 'hubspot_owner_id'],
  meetings: ['hs_meeting_body', 'hs_meeting_title', 'hs_timestamp', 'hubspot_owner_id'],
  tasks: ['hs_task_body', 'hs_task_subject', 'hs_timestamp', 'hubspot_owner_id'],
};

// ── HTTP helpers ─────────────────────────────────────────────────────────────

interface HubspotPage {
  results: HubspotRecord[];
  paging?: { next?: { after: string } };
}

/**
 * Properties is a multi-value query param (`?properties=a&properties=b&...`).
 * The framework's HttpClient `query` field is a Record<string, ...> with a
 * single value per key — so we precompose the property list into the path.
 * `buildUrl` parses it through `new URL(...)` and preserves all values.
 */
function pathWithProperties(objectType: ObjectType): string {
  const params = RECORD_PROPS[objectType].map((p) => `properties=${encodeURIComponent(p)}`).join('&');
  return `/crm/v3/objects/${objectType}?${params}`;
}

async function listRecords(
  api: HttpClient,
  objectType: ObjectType,
  opts: { updatedAfter?: string; after?: string },
): Promise<HubspotPage> {
  // When filtering by updated-after, the v3 search endpoint is the official
  // filter path. Without a filter, the cheaper paged GET is enough.
  if (opts.updatedAfter) {
    const lastModProp = objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate';
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: lastModProp, operator: 'GTE', value: opts.updatedAfter },
          ],
        },
      ],
      properties: RECORD_PROPS[objectType],
      sorts: [{ propertyName: lastModProp, direction: 'ASCENDING' }],
      limit: 100,
    };
    if (opts.after) body['after'] = opts.after;
    return api.post<HubspotPage>(`/crm/v3/objects/${objectType}/search`, body);
  }
  const query: Record<string, string | number> = { limit: 100 };
  if (opts.after) query['after'] = opts.after;
  return api.get<HubspotPage>(pathWithProperties(objectType), { query });
}

async function fetchEngagementsForRecord(
  api: HttpClient,
  objectType: ObjectType,
  recordId: string,
): Promise<HubspotEngagement[]> {
  const out: HubspotEngagement[] = [];

  for (const engType of ENGAGEMENT_OBJECT_TYPES) {
    // Step 1 — list associated engagement IDs.
    const associatedIds: string[] = [];
    let after: string | undefined;
    do {
      const query: Record<string, string | number> = { limit: 100 };
      if (after) query['after'] = after;
      const raw = await api.get<{
        results: Array<{ toObjectId?: string; id?: string }>;
        paging?: { next?: { after: string } };
      }>(`/crm/v3/objects/${objectType}/${recordId}/associations/${engType}`, { query });
      for (const r of raw.results ?? []) {
        const id = r.toObjectId ?? r.id;
        if (id) associatedIds.push(id);
      }
      after = raw.paging?.next?.after;
    } while (after);

    if (associatedIds.length === 0) continue;

    // Step 2 — batch read associated rows in 100s.
    for (let i = 0; i < associatedIds.length; i += 100) {
      const batch = associatedIds.slice(i, i + 100);
      const raw = await api.post<{ results: HubspotRecord[] }>(
        `/crm/v3/objects/${engType}/batch/read`,
        {
          properties: ENGAGEMENT_PROPS[engType],
          inputs: batch.map((id) => ({ id })),
        },
      );
      for (const r of raw.results ?? []) {
        const props = r.properties ?? {};
        const body = props[ENGAGEMENT_BODY_PROPERTY[engType]] ?? '';
        if (!body || body.trim().length === 0) continue;

        const eng: HubspotEngagement = {
          id: r.id,
          engagementType: ENGAGEMENT_TYPE_FOR_OBJECT[engType],
          createdAt: props['hs_timestamp'] ?? r.createdAt,
          body,
        };
        const ownerId = props['hubspot_owner_id'];
        if (ownerId) eng.ownerId = ownerId;

        if (engType === 'calls') {
          if (props['hs_call_title']) eng.subject = props['hs_call_title'] ?? undefined;
          if (props['hs_call_disposition']) eng.callOutcome = props['hs_call_disposition'] ?? undefined;
          const dur = props['hs_call_duration'];
          if (dur) {
            const n = Number(dur);
            if (Number.isFinite(n)) eng.callDurationSec = Math.round(n / 1000);
          }
        } else if (engType === 'emails' && props['hs_email_subject']) {
          eng.subject = props['hs_email_subject'] ?? undefined;
        } else if (engType === 'meetings' && props['hs_meeting_title']) {
          eng.subject = props['hs_meeting_title'] ?? undefined;
        } else if (engType === 'tasks' && props['hs_task_subject']) {
          eng.subject = props['hs_task_subject'] ?? undefined;
        }

        out.push(eng);
      }
    }
  }

  return out;
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function deriveDisplayName(
  recordType: HubspotRecordType,
  props: Record<string, string | null>,
): string {
  if (recordType === 'contact') {
    const first = props['firstname'] ?? '';
    const last = props['lastname'] ?? '';
    const joined = `${first} ${last}`.trim();
    if (joined) return joined;
    return props['email'] ?? 'Contact';
  }
  if (recordType === 'deal') return props['dealname'] ?? 'Deal';
  return props['name'] ?? props['domain'] ?? 'Company';
}

function nonEmptyProps(
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

/**
 * Fetch a record's engagements, run it through the chunker, and emit each
 * resulting chunk via ctx.upsert. Shared across all three resources.
 */
async function processRecord(
  ctx: ResourceSyncContext<unknown>,
  objectType: ObjectType,
  record: HubspotRecord,
): Promise<void> {
  const recordType = OBJECT_TO_RECORD_TYPE[objectType];

  // Engagement fetch failures shouldn't abort the record — the record can
  // still be indexed with just its own properties. Mirrors legacy behavior.
  let engagements: HubspotEngagement[] = [];
  try {
    engagements = await fetchEngagementsForRecord(ctx.api, objectType, record.id);
  } catch {
    /* skip engagements for this record */
  }

  const recordInput: HubspotRecordInput = {
    recordType,
    recordId: record.id,
    displayName: deriveDisplayName(recordType, record.properties ?? {}),
    properties: nonEmptyProps(record.properties ?? {}),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    engagements: engagements.map(mapEngagement),
  };

  // Every chunk produced from this record — record body + each engagement —
  // shares one source-artifacts row keyed by the parent record. The kind
  // varies (engagement chunks index separately for retrieval filtering) but
  // they all belong to the same HubSpot entity.
  const sourceArtifactId = `hubspot-${recordType}:${record.id}`;

  const rawChunks = await hubspotRecordChunker.chunk(recordInput, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });

  for (const c of rawChunks) {
    // The chunker tags engagement chunks via metadata.chunk_role. Engagements
    // get a separate chunk kind so retrieval can filter by activity type.
    const role = c.metadata['chunk_role'];
    const kind: 'hubspot-contact' | 'hubspot-deal' | 'hubspot-company' | 'hubspot-engagement' =
      role === 'engagement'
        ? 'hubspot-engagement'
        : recordType === 'contact'
          ? 'hubspot-contact'
          : recordType === 'deal'
            ? 'hubspot-deal'
            : 'hubspot-company';
    await ctx.upsert({
      externalId: record.id,
      kind,
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}

// ── Resource builder ─────────────────────────────────────────────────────────

const objectCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent record we've ingested for this object type. */
    updatedAt: z.string().optional(),
  })
  .default({});

type ObjectCursor = z.infer<typeof objectCursorSchema>;

function buildObjectResource(objectType: ObjectType): {
  id: string;
  displayName: string;
  cursorSchema: typeof objectCursorSchema;
  sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor>;
} {
  const recordType = OBJECT_TO_RECORD_TYPE[objectType];
  return {
    id: objectType,
    displayName: objectType[0]!.toUpperCase() + objectType.slice(1),
    cursorSchema: objectCursorSchema,
    async sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor> {
      let after: string | undefined;
      let highest = ctx.cursor.updatedAt;
      let pageNum = 0;

      do {
        ctx.signal?.throwIfAborted();
        pageNum += 1;
        ctx.reportProgress?.({
          current: pageNum,
          total: null,
          message: `Fetching ${recordType}s · page ${pageNum}`,
        });

        let page: HubspotPage;
        try {
          page = await listRecords(ctx.api, objectType, {
            updatedAfter: ctx.cursor.updatedAt,
            after,
          });
        } catch {
          // Listing failure aborts THIS resource only — the runtime moves on
          // to the next resource on the next iteration.
          break;
        }

        for (const record of page.results ?? []) {
          ctx.signal?.throwIfAborted();
          await processRecord(ctx, objectType, record);
          if (!highest || record.updatedAt > highest) highest = record.updatedAt;
        }

        after = page.paging?.next?.after;
      } while (after);

      return { updatedAt: highest };
    },
  };
}

// ── Spec ─────────────────────────────────────────────────────────────────────

export function createHubspotSpec(_opts: HubspotSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'hubspot',
    displayName: 'HubSpot',

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.hubapi.com',
      defaultHeaders: { Accept: 'application/json' },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const raw = await ctx.api.get<{
        portalId?: number;
        hub_id?: number;
        accountType?: string;
        timeZone?: string;
      }>('/account-info/v3/details');
      const id = String(raw.portalId ?? raw.hub_id ?? 'unknown');
      const name = raw.accountType ? `Hub ${id} (${raw.accountType})` : `Hub ${id}`;
      return { externalId: id, name, raw: { hub_id: id, hub_name: name } };
    },

    resources: [
      buildObjectResource('contacts'),
      buildObjectResource('deals'),
      buildObjectResource('companies'),
    ],

    ui: {
      description: 'CRM contacts, deals, companies, and engagement timelines.',
      category: 'crm',
    },
  });
}
