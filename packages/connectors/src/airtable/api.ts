/**
 * Airtable Web API helpers built on the framework's HttpClient.
 *
 * Airtable uses a simple offset-based pagination scheme: each list response
 * may include `offset` which is passed back as a query parameter to fetch
 * the next page. There's no Link header and no cursor envelope — straight
 * JSON.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  AirtableBase,
  AirtableBasesList,
  AirtableRecord,
  AirtableRecordsList,
  AirtableTable,
  AirtableTablesList,
  AirtableUserMe,
} from './types';

/** Identify the connecting workspace user. */
export async function whoami(api: HttpClient): Promise<AirtableUserMe> {
  return api.get<AirtableUserMe>('/meta/whoami');
}

/** All bases the token can see. */
export async function* iterateBases(
  api: HttpClient,
  signal?: AbortSignal,
): AsyncGenerator<AirtableBase> {
  let offset: string | undefined;
  do {
    signal?.throwIfAborted();
    const query: Record<string, string> = {};
    if (offset) query['offset'] = offset;
    const res = await api.get<AirtableBasesList>('/meta/bases', { query });
    for (const b of res.bases) yield b;
    offset = res.offset ?? undefined;
  } while (offset);
}

/** Tables (with field metadata) for a base. */
export async function listTables(
  api: HttpClient,
  baseId: string,
): Promise<AirtableTable[]> {
  const res = await api.get<AirtableTablesList>(`/meta/bases/${baseId}/tables`);
  return res.tables;
}

/**
 * Iterate every record in a table, optionally narrowed by an Airtable
 * formula (used for incremental sync via `LAST_MODIFIED_TIME() >= …`).
 */
export async function* iterateRecords(
  api: HttpClient,
  baseId: string,
  tableIdOrName: string,
  opts: { filterByFormula?: string; signal?: AbortSignal } = {},
): AsyncGenerator<AirtableRecord> {
  let offset: string | undefined;
  do {
    opts.signal?.throwIfAborted();
    const query: Record<string, string | number> = { pageSize: 100 };
    if (offset) query['offset'] = offset;
    if (opts.filterByFormula) query['filterByFormula'] = opts.filterByFormula;
    const res = await api.get<AirtableRecordsList>(
      `/${baseId}/${encodeURIComponent(tableIdOrName)}`,
      { query },
    );
    for (const r of res.records) yield r;
    offset = res.offset ?? undefined;
  } while (offset);
}

export function isStatus(err: unknown, status: number): boolean {
  if (err && typeof err === 'object') {
    if ((err as { status?: unknown }).status === status) return true;
    const problem = (err as { problem?: unknown }).problem;
    if (typeof problem === 'string' && problem.includes(`returned ${status}`)) {
      return true;
    }
  }
  return false;
}
