import { holoError, ErrorCode } from '@holo/errors';

export type HubspotObjectType = 'contacts' | 'deals' | 'companies';

export interface HubspotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface HubspotListPage {
  results: HubspotRecord[];
  nextAfter?: string;
}

/**
 * Engagement payloads from the v3 `crm/v3/objects/{notes,calls,emails,meetings,tasks}`
 * endpoints share a uniform property bag keyed by engagement type. We normalize
 * down to the few fields we actually want in retrieval.
 */
export interface HubspotEngagement {
  id: string;
  engagementType: 'note' | 'call' | 'email' | 'meeting' | 'task';
  createdAt: string;
  body: string;
  ownerId?: string;
  subject?: string;
  callOutcome?: string;
  callDurationSec?: number;
}

export interface HubspotApiClient {
  listRecords(
    objectType: HubspotObjectType,
    opts: { updatedAfter?: string; after?: string },
  ): Promise<HubspotListPage>;
  getEngagementsForRecord(
    objectType: HubspotObjectType,
    recordId: string,
  ): Promise<HubspotEngagement[]>;
  testConnection(): Promise<{ id: string; name: string }>;
}

const BASE = 'https://api.hubapi.com';

const RECORD_PROPS: Record<HubspotObjectType, string[]> = {
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

const ENGAGEMENT_TYPE_FOR_OBJECT: Record<(typeof ENGAGEMENT_OBJECT_TYPES)[number], HubspotEngagement['engagementType']> = {
  notes: 'note',
  calls: 'call',
  emails: 'email',
  meetings: 'meeting',
  tasks: 'task',
};

const ENGAGEMENT_BODY_PROPERTY: Record<(typeof ENGAGEMENT_OBJECT_TYPES)[number], string> = {
  notes: 'hs_note_body',
  calls: 'hs_call_body',
  emails: 'hs_email_text',
  meetings: 'hs_meeting_body',
  tasks: 'hs_task_body',
};

const ENGAGEMENT_PROPS: Record<(typeof ENGAGEMENT_OBJECT_TYPES)[number], string[]> = {
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

export function createHubspotApiClient(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): HubspotApiClient {
  async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `HubSpot token rejected (${res.status} at ${path})`,
          fix: 'Reconnect HubSpot from /connections to refresh credentials.',
        });
      }
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `HubSpot API error ${res.status} at ${path}`,
        cause: await res.text().catch(() => undefined),
        fix: 'Check the requested resource and retry; HubSpot may be rate-limiting.',
      });
    }
    return res.json() as Promise<T>;
  }

  return {
    async listRecords(objectType, opts) {
      const params = new URLSearchParams({ limit: '100' });
      for (const p of RECORD_PROPS[objectType]) params.append('properties', p);
      if (opts.after) params.set('after', opts.after);

      // Use search endpoint when filtering by updatedAfter; otherwise the
      // cheaper paged GET. Search is POST-based with a JSON body.
      if (opts.updatedAfter) {
        const lastModProp =
          objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate';
        const body = {
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
          after: opts.after,
        };
        const raw = await apiFetch<{
          results: HubspotRecord[];
          paging?: { next?: { after: string } };
        }>(`/crm/v3/objects/${objectType}/search`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return {
          results: raw.results ?? [],
          nextAfter: raw.paging?.next?.after,
        };
      }

      const raw = await apiFetch<{
        results: HubspotRecord[];
        paging?: { next?: { after: string } };
      }>(`/crm/v3/objects/${objectType}?${params.toString()}`);
      return {
        results: raw.results ?? [],
        nextAfter: raw.paging?.next?.after,
      };
    },

    async getEngagementsForRecord(objectType, recordId) {
      const out: HubspotEngagement[] = [];

      for (const engType of ENGAGEMENT_OBJECT_TYPES) {
        // Step 1 — list associated engagement IDs.
        let after: string | undefined;
        const associatedIds: string[] = [];
        do {
          const params = new URLSearchParams({ limit: '100' });
          if (after) params.set('after', after);
          const raw = await apiFetch<{
            results: Array<{ toObjectId?: string; id?: string }>;
            paging?: { next?: { after: string } };
          }>(
            `/crm/v3/objects/${objectType}/${recordId}/associations/${engType}?${params.toString()}`,
          );
          for (const r of raw.results ?? []) {
            const id = r.toObjectId ?? r.id;
            if (id) associatedIds.push(id);
          }
          after = raw.paging?.next?.after;
        } while (after);

        if (associatedIds.length === 0) continue;

        // Step 2 — batch read in 100s.
        for (let i = 0; i < associatedIds.length; i += 100) {
          const chunk = associatedIds.slice(i, i + 100);
          const raw = await apiFetch<{
            results: HubspotRecord[];
          }>(`/crm/v3/objects/${engType}/batch/read`, {
            method: 'POST',
            body: JSON.stringify({
              properties: ENGAGEMENT_PROPS[engType],
              inputs: chunk.map((id) => ({ id })),
            }),
          });

          for (const r of raw.results ?? []) {
            const props = r.properties ?? {};
            const bodyKey = ENGAGEMENT_BODY_PROPERTY[engType];
            const body = props[bodyKey] ?? '';
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
              const subj = props['hs_call_title'];
              if (subj) eng.subject = subj;
              const outcome = props['hs_call_disposition'];
              if (outcome) eng.callOutcome = outcome;
              const dur = props['hs_call_duration'];
              if (dur) {
                const n = Number(dur);
                if (Number.isFinite(n)) eng.callDurationSec = Math.round(n / 1000);
              }
            } else if (engType === 'emails') {
              const subj = props['hs_email_subject'];
              if (subj) eng.subject = subj;
            } else if (engType === 'meetings') {
              const subj = props['hs_meeting_title'];
              if (subj) eng.subject = subj;
            } else if (engType === 'tasks') {
              const subj = props['hs_task_subject'];
              if (subj) eng.subject = subj;
            }

            out.push(eng);
          }
        }
      }

      return out;
    },

    async testConnection() {
      const raw = await apiFetch<{
        portalId?: number;
        hub_id?: number;
        accountType?: string;
        timeZone?: string;
      }>('/account-info/v3/details');
      const id = String(raw.portalId ?? raw.hub_id ?? 'unknown');
      return { id, name: raw.accountType ? `Hub ${id} (${raw.accountType})` : `Hub ${id}` };
    },
  };
}
