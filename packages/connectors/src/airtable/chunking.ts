/**
 * Airtable record → chunk projection. One chunk per record, with a header
 * line identifying the base/table and a body that flattens the record's
 * fields into `Field: value` lines so retrieval picks up both field names
 * and values.
 *
 * Airtable record fields are arbitrary user data — strings, numbers,
 * arrays, attachment objects, etc. We stringify everything to a
 * predictable text form (skipping empty values) rather than trying to
 * preserve typed field shapes in the chunk content.
 */
import type { ResourceSyncContext } from '@holo/connector-framework';
import type {
  AirtableBase,
  AirtableField,
  AirtableRecord,
  AirtableTable,
} from './types';

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => stringifyValue(v))
      .filter((s) => s.length > 0)
      .join(', ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // Attachment objects expose a useful `filename` + `url`; collaborator
    // fields expose `name` / `email`. Fall through to JSON for the rest so
    // nothing important silently disappears from the chunk body.
    if (typeof o['filename'] === 'string') {
      const name = o['filename'] as string;
      const url = typeof o['url'] === 'string' ? ` (${o['url']})` : '';
      return `${name}${url}`;
    }
    if (typeof o['name'] === 'string') return o['name'] as string;
    if (typeof o['email'] === 'string') return o['email'] as string;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function primaryDisplay(
  record: AirtableRecord,
  table: AirtableTable,
): string {
  const primary = table.fields.find((f) => f.id === table.primaryFieldId);
  if (!primary) return record.id;
  const v = stringifyValue(record.fields[primary.name]);
  return v.length > 0 ? v : record.id;
}

function projectRecordToContent(input: {
  record: AirtableRecord;
  base: AirtableBase;
  table: AirtableTable;
}): string {
  const { record, base, table } = input;
  const lines: string[] = [];
  lines.push(`[${base.name} · ${table.name}] ${primaryDisplay(record, table)}`);

  // Field rendering follows table.fields order so output is stable across
  // syncs (Airtable returns record fields as an unordered map).
  const body: string[] = [];
  for (const field of table.fields) {
    const raw = record.fields[field.name];
    const text = stringifyValue(raw);
    if (text.length === 0) continue;
    body.push(`${field.name}: ${text}`);
  }
  if (body.length > 0) {
    lines.push('');
    lines.push(body.join('\n'));
  }
  return lines.join('\n');
}

function aclSubjectsFor(base: AirtableBase, organizationId: string): string[] {
  // Airtable's API doesn't expose per-record permissions; the base is the
  // smallest unit a token can be scoped to. The token itself is workspace-
  // scoped (a PAT against the org's Airtable account), so every member of
  // this Holo org has read access — emit `org:${id}` so the Files panel +
  // RAG retrieval can see these rows alongside slack/notion. The per-base
  // subject is retained for future per-base ACL features.
  return [`org:${organizationId}`, `airtable:base:${base.id}`, `airtable:org`];
}

export async function processRecord(
  ctx: ResourceSyncContext<unknown>,
  input: {
    record: AirtableRecord;
    base: AirtableBase;
    table: AirtableTable;
  },
): Promise<void> {
  const { record, base, table } = input;
  await ctx.upsert({
    externalId: `${base.id}:${table.id}:${record.id}`,
    kind: 'airtable-record',
    content: projectRecordToContent({ record, base, table }),
    aclSubjects: aclSubjectsFor(base, ctx.organizationId),
    metadata: {
      baseId: base.id,
      baseName: base.name,
      tableId: table.id,
      tableName: table.name,
      recordId: record.id,
      createdTime: record.createdTime,
      url: `https://airtable.com/${base.id}/${table.id}/${record.id}`,
      primaryFieldId: table.primaryFieldId,
      fieldNames: table.fields.map((f: AirtableField) => f.name),
    },
  });
}
