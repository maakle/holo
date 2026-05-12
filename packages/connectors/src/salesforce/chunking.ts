/**
 * Salesforce record → chunk projection.
 *
 * A record's "body" (account / contact / opportunity) and its activity
 * timeline (tasks / events / notes) all share one source-artifacts row keyed
 * by the parent record. Chunk `kind` differs (salesforce-activity vs the
 * per-record kind) so retrieval can filter by activity.
 */
import {
  salesforceRecordChunker,
  type SalesforceActivity,
  type SalesforceActivityType,
  type SalesforceRecordInput,
  type SalesforceRecordType,
} from '@holo/chunker';
import type { HttpClient, ResourceSyncContext } from '@holo/connector-framework';
import {
  fetchActivitiesForBatch,
  fetchNotesForBatch,
} from './api';
import type {
  SalesforceActivityRecord,
  SalesforceContentNoteRecord,
  SalesforceObjectType,
  SalesforceRecord,
  SalesforceResourceId,
} from './types';

const RESOURCE_TO_RECORD_TYPE: Record<SalesforceResourceId, SalesforceRecordType> = {
  accounts: 'account',
  contacts: 'contact',
  opportunities: 'opportunity',
};

const RESOURCE_TO_OBJECT: Record<SalesforceResourceId, SalesforceObjectType> = {
  accounts: 'Account',
  contacts: 'Contact',
  opportunities: 'Opportunity',
};

function deriveDisplayName(
  recordType: SalesforceRecordType,
  record: SalesforceRecord,
): string {
  if (recordType === 'contact') {
    const first = (record['FirstName'] as string | null | undefined) ?? '';
    const last = (record['LastName'] as string | null | undefined) ?? '';
    const joined = `${first} ${last}`.trim();
    if (joined) return joined;
    return (record['Email'] as string | null | undefined) ?? 'Contact';
  }
  if (recordType === 'opportunity') {
    return (record['Name'] as string | null | undefined) ?? 'Opportunity';
  }
  return (record['Name'] as string | null | undefined) ?? 'Account';
}

function nonEmptyProps(
  record: SalesforceRecord,
): Record<string, string | number | boolean | null | undefined> {
  const out: Record<string, string | number | boolean | null | undefined> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'attributes' || k === 'Id' || k === 'CreatedDate' || k === 'SystemModstamp') continue;
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function activityType(rec: SalesforceActivityRecord): SalesforceActivityType {
  if (rec.__kind === 'event') return 'meeting';
  // Tasks: inspect CallType to distinguish call/email; default to 'task'.
  if (rec.CallType) return 'call';
  const subj = (rec.Subject ?? '').toLowerCase();
  if (subj.startsWith('email:')) return 'email';
  if (subj.startsWith('call')) return 'call';
  return 'task';
}

function activityBody(rec: SalesforceActivityRecord): string {
  const desc = (rec.Description ?? '').trim();
  if (desc) return desc;
  // Falls back to subject so a content-less Task still produces a chunk
  // when paired with a meaningful subject (e.g. "Follow up with Acme").
  return (rec.Subject ?? '').trim();
}

function mapActivity(rec: SalesforceActivityRecord): SalesforceActivity | null {
  const body = activityBody(rec);
  if (!body) return null;
  const createdAt = new Date(rec.StartDateTime ?? rec.CreatedDate);
  const a: SalesforceActivity = {
    id: rec.Id,
    type: activityType(rec),
    createdAt,
    body,
  };
  if (rec.Subject) a.subject = rec.Subject;
  if (rec.Owner?.Name) a.ownerName = rec.Owner.Name;
  if (rec.Status) a.callOutcome = rec.Status;
  if (typeof rec.CallDurationInSeconds === 'number') {
    a.callDurationSec = rec.CallDurationInSeconds;
  }
  return a;
}

function mapNote(rec: SalesforceContentNoteRecord): SalesforceActivity | null {
  const body = (rec.TextPreview ?? '').trim();
  if (!body) return null;
  const a: SalesforceActivity = {
    id: rec.Id,
    type: 'note',
    createdAt: new Date(rec.CreatedDate),
    body,
  };
  if (rec.Title) a.subject = rec.Title;
  if (rec.Owner?.Name) a.ownerName = rec.Owner.Name;
  return a;
}

/**
 * Fetch activities + notes for a batch of records, then index each through
 * the salesforceRecordChunker. Mirrors HubSpot's per-record processing shape
 * but batches the activity fetch across the whole page (Salesforce SOQL is
 * cheaper per-call when joining many parents than HubSpot's per-record
 * association lookup).
 */
export async function processRecordBatch(
  ctx: ResourceSyncContext<unknown>,
  api: HttpClient,
  resourceId: SalesforceResourceId,
  records: ReadonlyArray<SalesforceRecord>,
): Promise<void> {
  if (records.length === 0) return;
  const recordType = RESOURCE_TO_RECORD_TYPE[resourceId];
  const object = RESOURCE_TO_OBJECT[resourceId];
  const ids = records.map((r) => r.Id);

  // Activity-fetch failures shouldn't abort the batch — record bodies can
  // still be indexed alone. Mirrors HubSpot's per-record fallback.
  const activitiesByParent = new Map<string, SalesforceActivity[]>();
  try {
    const relationship = object === 'Contact' ? 'WhoId' : 'WhatId';
    const activities = await fetchActivitiesForBatch(api, ids, relationship);
    for (const rec of activities) {
      const parentId = (relationship === 'WhoId' ? rec.WhoId : rec.WhatId) ?? null;
      if (!parentId) continue;
      const mapped = mapActivity(rec);
      if (!mapped) continue;
      const arr = activitiesByParent.get(parentId) ?? [];
      arr.push(mapped);
      activitiesByParent.set(parentId, arr);
    }
  } catch {
    /* skip activities for this batch */
  }

  try {
    const notesByParent = await fetchNotesForBatch(api, ids);
    for (const [parentId, notes] of notesByParent) {
      const arr = activitiesByParent.get(parentId) ?? [];
      for (const n of notes) {
        const mapped = mapNote(n);
        if (mapped) arr.push(mapped);
      }
      activitiesByParent.set(parentId, arr);
    }
  } catch {
    /* skip notes for this batch */
  }

  for (const record of records) {
    ctx.signal?.throwIfAborted();
    const recordInput: SalesforceRecordInput = {
      recordType,
      recordId: record.Id,
      displayName: deriveDisplayName(recordType, record),
      properties: nonEmptyProps(record),
      createdAt: new Date(record.CreatedDate),
      updatedAt: new Date(record.SystemModstamp),
      activities: activitiesByParent.get(record.Id) ?? [],
    };

    const sourceArtifactId = `salesforce-${recordType}:${record.Id}`;
    const rawChunks = await salesforceRecordChunker.chunk(recordInput, {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    });

    for (const c of rawChunks) {
      const role = c.metadata['chunk_role'];
      const kind:
        | 'salesforce-account'
        | 'salesforce-contact'
        | 'salesforce-opportunity'
        | 'salesforce-activity' =
        role === 'activity'
          ? 'salesforce-activity'
          : recordType === 'account'
            ? 'salesforce-account'
            : recordType === 'contact'
              ? 'salesforce-contact'
              : 'salesforce-opportunity';
      await ctx.upsert({
        externalId: record.Id,
        kind,
        content: c.content,
        metadata: c.metadata,
        aclSubjects: c.aclSubjects,
        sourceArtifactId,
      });
    }
  }
}
