/**
 * Salesforce REST API helpers built on the framework's HttpClient.
 *
 * Salesforce uses SOQL ("SELECT … FROM SObject WHERE …") issued against
 * `/services/data/v60.0/query`. Pagination is via `nextRecordsUrl`, which is
 * an absolute path returned by the server. Incremental sync filters on
 * `SystemModstamp` (Salesforce's wall-clock-stable last-modified timestamp).
 *
 * Activity fetch is a per-batch SOQL on Task + Event filtered by `WhatId IN
 * (...)` for Account/Opportunity and `WhoId IN (...)` for Contact, then a
 * second pass joins ContentNote via ContentDocumentLink.
 */
import type { HttpClient } from '@holo/connector-framework';
import { ErrorCode, holoError } from '@holo/errors';
import type {
  SalesforceActivityRecord,
  SalesforceContentDocumentLinkRecord,
  SalesforceContentNoteRecord,
  SalesforceObjectType,
  SalesforceQueryResponse,
  SalesforceRecord,
} from './types';

const API_VERSION = 'v60.0';

const RECORD_FIELDS: Record<SalesforceObjectType, ReadonlyArray<string>> = {
  Account: [
    'Id',
    'Name',
    'Website',
    'Industry',
    'NumberOfEmployees',
    'AnnualRevenue',
    'Description',
    'Type',
    'Phone',
    'BillingCountry',
    'CreatedDate',
    'SystemModstamp',
  ],
  Contact: [
    'Id',
    'FirstName',
    'LastName',
    'Email',
    'Phone',
    'Title',
    'Department',
    'LeadSource',
    'AccountId',
    'CreatedDate',
    'SystemModstamp',
  ],
  Opportunity: [
    'Id',
    'Name',
    'StageName',
    'Amount',
    'CloseDate',
    'Probability',
    'Type',
    'Description',
    'AccountId',
    'CreatedDate',
    'SystemModstamp',
  ],
};

/** Maximum SOQL batch size for the framework's REST query endpoint. */
const PAGE_SIZE = 200;

/**
 * Salesforce caps SOQL statement length at 100k chars. Activity batches join
 * up to ~200 parent ids per query — well below the limit even with the
 * longest 18-char ids.
 */
const ACTIVITY_BATCH_SIZE = 200;

function escapeSoqlLiteral(value: string): string {
  // Reject any character that would break out of a SOQL literal — Salesforce
  // record ids and ISO timestamps are alphanumeric, so anything else is a
  // bug or an attack and must not flow into the query string.
  if (!/^[A-Za-z0-9._:+\-T]+$/.test(value)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Salesforce: refusing to inline non-alphanumeric SOQL literal: ${value}`,
      fix: 'Salesforce ids and SystemModstamp values are alphanumeric — investigate where this value originated.',
    });
  }
  return value;
}

function quoteIds(ids: ReadonlyArray<string>): string {
  return ids.map((id) => `'${escapeSoqlLiteral(id)}'`).join(',');
}

export function buildRecordSoql(
  object: SalesforceObjectType,
  opts: { updatedAfter?: string },
): string {
  const fields = RECORD_FIELDS[object].join(', ');
  const where = opts.updatedAfter
    ? ` WHERE SystemModstamp > ${escapeSoqlLiteral(opts.updatedAfter)}`
    : '';
  return `SELECT ${fields} FROM ${object}${where} ORDER BY SystemModstamp ASC LIMIT ${PAGE_SIZE}`;
}

/**
 * Issue a SOQL query. Salesforce returns at most `PAGE_SIZE` records per call;
 * subsequent pages are fetched via `nextRecordsUrl`.
 */
export async function querySoql<T = SalesforceRecord>(
  api: HttpClient,
  soql: string,
): Promise<SalesforceQueryResponse<T>> {
  return api.get<SalesforceQueryResponse<T>>(`/services/data/${API_VERSION}/query`, {
    query: { q: soql },
  });
}

export async function queryNext<T = SalesforceRecord>(
  api: HttpClient,
  nextRecordsUrl: string,
): Promise<SalesforceQueryResponse<T>> {
  return api.get<SalesforceQueryResponse<T>>(nextRecordsUrl);
}

export async function listRecords(
  api: HttpClient,
  object: SalesforceObjectType,
  opts: { updatedAfter?: string },
): Promise<SalesforceQueryResponse> {
  return querySoql(api, buildRecordSoql(object, opts));
}

/**
 * Fetch Tasks + Events associated with a batch of parent record ids.
 * Tasks/Events use `WhatId` for Account/Opportunity associations and `WhoId`
 * for Contact associations — caller picks the relationship column.
 */
export async function fetchActivitiesForBatch(
  api: HttpClient,
  parentIds: ReadonlyArray<string>,
  relationship: 'WhatId' | 'WhoId',
): Promise<SalesforceActivityRecord[]> {
  if (parentIds.length === 0) return [];
  const out: SalesforceActivityRecord[] = [];

  for (let i = 0; i < parentIds.length; i += ACTIVITY_BATCH_SIZE) {
    const batch = parentIds.slice(i, i + ACTIVITY_BATCH_SIZE);
    const inList = quoteIds(batch);

    const taskSoql =
      `SELECT Id, ${relationship}, Subject, Description, ActivityDate, CreatedDate, ` +
      `Status, CallType, CallDurationInSeconds, Owner.Name FROM Task ` +
      `WHERE ${relationship} IN (${inList}) ORDER BY CreatedDate ASC LIMIT 2000`;
    const tasks = await querySoql<SalesforceActivityRecord>(api, taskSoql);
    for (const r of tasks.records ?? []) out.push({ ...r, __kind: 'task' });

    const eventSoql =
      `SELECT Id, ${relationship}, Subject, Description, ActivityDate, CreatedDate, ` +
      `StartDateTime, Location, Owner.Name FROM Event ` +
      `WHERE ${relationship} IN (${inList}) ORDER BY CreatedDate ASC LIMIT 2000`;
    const events = await querySoql<SalesforceActivityRecord>(api, eventSoql);
    for (const r of events.records ?? []) out.push({ ...r, __kind: 'event' });
  }

  return out;
}

/**
 * Fetch ContentNote records linked to a batch of parent record ids via
 * ContentDocumentLink. Returns notes keyed by parent id (a single note can
 * be linked to multiple parents — the caller decides whether to dedupe).
 */
export async function fetchNotesForBatch(
  api: HttpClient,
  parentIds: ReadonlyArray<string>,
): Promise<Map<string, SalesforceContentNoteRecord[]>> {
  const out = new Map<string, SalesforceContentNoteRecord[]>();
  if (parentIds.length === 0) return out;

  for (let i = 0; i < parentIds.length; i += ACTIVITY_BATCH_SIZE) {
    const batch = parentIds.slice(i, i + ACTIVITY_BATCH_SIZE);
    const inList = quoteIds(batch);

    const linkSoql =
      `SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink ` +
      `WHERE LinkedEntityId IN (${inList}) LIMIT 2000`;
    const links = await querySoql<SalesforceContentDocumentLinkRecord>(api, linkSoql);
    const linksByDoc = new Map<string, string[]>();
    for (const l of links.records ?? []) {
      const arr = linksByDoc.get(l.ContentDocumentId) ?? [];
      arr.push(l.LinkedEntityId);
      linksByDoc.set(l.ContentDocumentId, arr);
    }
    if (linksByDoc.size === 0) continue;

    const docIds = [...linksByDoc.keys()];
    for (let j = 0; j < docIds.length; j += ACTIVITY_BATCH_SIZE) {
      const docBatch = docIds.slice(j, j + ACTIVITY_BATCH_SIZE);
      const noteSoql =
        `SELECT Id, Title, TextPreview, CreatedDate, Owner.Name FROM ContentNote ` +
        `WHERE Id IN (${quoteIds(docBatch)}) LIMIT 2000`;
      const notes = await querySoql<SalesforceContentNoteRecord>(api, noteSoql);
      for (const n of notes.records ?? []) {
        const parents = linksByDoc.get(n.Id) ?? [];
        for (const parentId of parents) {
          const arr = out.get(parentId) ?? [];
          arr.push(n);
          out.set(parentId, arr);
        }
      }
    }
  }

  return out;
}

/**
 * Salesforce identity introspection — hit the token's `id` URL to learn the
 * org id, user id, and display name. Used by `testConnection` after the
 * OAuth callback.
 */
export interface SalesforceIdentity {
  user_id: string;
  organization_id: string;
  username: string;
  display_name: string;
}

export async function fetchIdentity(
  fetchImpl: typeof fetch,
  idUrl: string,
  accessToken: string,
): Promise<SalesforceIdentity> {
  const res = await fetchImpl(idUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Salesforce identity endpoint returned ${res.status}`,
      fix: 'Restart the connect flow; the access token may already be invalidated.',
    });
  }
  return (await res.json()) as SalesforceIdentity;
}

/**
 * Lightweight connectivity check used by the resync path. Hitting
 * `/services/data` (no version) returns the list of available API versions
 * and works on any instance URL that has a valid session — cheap probe
 * without needing the SObject describe permissions.
 */
export async function pingInstance(api: HttpClient): Promise<void> {
  await api.get<unknown>('/services/data');
}
