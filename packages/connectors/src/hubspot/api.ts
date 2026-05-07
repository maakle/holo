/**
 * HubSpot API helpers built on the framework's HttpClient.
 *
 * Two listing strategies:
 *   - cheap paged GET when no watermark (full sweep)
 *   - v3 search POST with filterGroups when filtering by `updatedAfter`
 *
 * Engagement fetch is a two-step dance per record: list associated ids, then
 * batch-read in 100s.
 */
import type { HttpClient } from '@holo/connector-framework';
import type { HubspotEngagement, HubspotObjectType, HubspotPage, HubspotRecord } from './types';

// ── HubSpot constants ────────────────────────────────────────────────────────

const RECORD_PROPS: Record<HubspotObjectType, ReadonlyArray<string>> = {
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

/**
 * `properties` is a multi-value query param (`?properties=a&properties=b…`).
 * The framework's HttpClient query map is single-value, so we precompose
 * into the path; `new URL(...)` parsing in the framework preserves all values.
 */
function pathWithProperties(objectType: HubspotObjectType): string {
  const params = RECORD_PROPS[objectType]
    .map((p) => `properties=${encodeURIComponent(p)}`)
    .join('&');
  return `/crm/v3/objects/${objectType}?${params}`;
}

export async function listRecords(
  api: HttpClient,
  objectType: HubspotObjectType,
  opts: { updatedAfter?: string; after?: string },
): Promise<HubspotPage> {
  if (opts.updatedAfter) {
    const lastModProp =
      objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate';
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

export async function fetchEngagementsForRecord(
  api: HttpClient,
  objectType: HubspotObjectType,
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

    // Step 2 — batch-read the associated rows in 100s.
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
          if (props['hs_call_disposition'])
            eng.callOutcome = props['hs_call_disposition'] ?? undefined;
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
