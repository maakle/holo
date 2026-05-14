import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type AllowlistEntry,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { createAirtableSpec } from '../src/airtable/index';
import type {
  AirtableBase,
  AirtableRecord,
  AirtableTable,
} from '../src/airtable/types';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  allowlist?: ReadonlyArray<AllowlistEntry>;
}): {
  stores: RuntimeStores;
  enqueued: ChunkRecord[];
  savedCursors: Array<{ resourceId: string; cursor: unknown }>;
} {
  const enqueued: ChunkRecord[] = [];
  const savedCursors: Array<{ resourceId: string; cursor: unknown }> = [];
  const cursors = { ...(initial?.cursors ?? {}) };
  return {
    enqueued,
    savedCursors,
    stores: {
      async loadTokens() {
        return { accessToken: 'pat_test_token' };
      },
      async loadCursor({ resourceId }) {
        return cursors[resourceId];
      },
      async saveCursor({ resourceId, cursor }) {
        cursors[resourceId] = cursor;
        savedCursors.push({ resourceId, cursor });
      },
      async loadExistingHashes() {
        return new Set(initial?.existingHashes ?? []);
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
      async loadAllowlist() {
        return initial?.allowlist ?? [];
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

const wildcardAllowlist: ReadonlyArray<AllowlistEntry> = [
  { pattern: '*', patternKind: 'glob', decision: 'include' },
];

function makeBase(id: string, name: string): AirtableBase {
  return { id, name, permissionLevel: 'edit' };
}

function makeTable(partial: Partial<AirtableTable> & { id: string; name: string }): AirtableTable {
  return {
    id: partial.id,
    name: partial.name,
    primaryFieldId: partial.primaryFieldId ?? 'fld-name',
    fields: partial.fields ?? [
      { id: 'fld-name', name: 'Name', type: 'singleLineText' },
      { id: 'fld-notes', name: 'Notes', type: 'multilineText' },
    ],
  };
}

function makeRecord(
  id: string,
  fields: Record<string, unknown>,
  createdTime = '2026-05-01T10:00:00.000Z',
): AirtableRecord {
  return { id, createdTime, fields };
}

describe('createAirtableSpec', () => {
  it('declares the expected id, http config, and one resource', () => {
    const spec = createAirtableSpec();
    expect(spec.id).toBe('airtable');
    expect(spec.displayName).toBe('Airtable');
    expect(spec.http?.baseUrl).toBe('https://api.airtable.com/v0');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('records');
    expect(spec.auth.kind).toBe('apiKey');
  });
});

describe('Airtable sync (full, wildcard allowlist)', () => {
  it('expands wildcards to accessible bases and emits one chunk per record', async () => {
    const baseA = makeBase('appAAA', 'Customers');
    const tableProspects = makeTable({ id: 'tblProspects', name: 'Prospects' });
    const r1 = makeRecord('rec1', { Name: 'Acme', Notes: 'big lead' });
    const r2 = makeRecord('rec2', { Name: 'Globex', Notes: '' });

    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.includes('/meta/bases/appAAA/tables')) {
        return jsonResponse({ tables: [tableProspects] });
      }
      if (req.url.includes('/meta/bases')) {
        return jsonResponse({ bases: [baseA] });
      }
      if (req.url.includes('/appAAA/tblProspects')) {
        return jsonResponse({ records: [r1, r2] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createAirtableSpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({ allowlist: wildcardAllowlist });

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBe(2);
    expect(enqueued).toHaveLength(2);

    // Auth header is the PAT.
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer pat_test_token');

    // Cursor key is `${baseId}:${tableId}` and is set to the highest createdTime.
    const lastCursor = savedCursors.at(-1)?.cursor as {
      lastModifiedPerTable: Record<string, string>;
    };
    expect(lastCursor.lastModifiedPerTable['appAAA:tblProspects']).toBe(
      '2026-05-01T10:00:00.000Z',
    );
  });

  it('renders chunk content with header line, field rows, and acl subjects', async () => {
    const baseA = makeBase('appAAA', 'Customers');
    const tableProspects = makeTable({
      id: 'tblProspects',
      name: 'Prospects',
      fields: [
        { id: 'fld-name', name: 'Name', type: 'singleLineText' },
        { id: 'fld-notes', name: 'Notes', type: 'multilineText' },
        { id: 'fld-tags', name: 'Tags', type: 'multipleSelects' },
      ],
    });
    const record = makeRecord('rec1', {
      Name: 'Acme Corp',
      Notes: 'Large enterprise lead.',
      Tags: ['hot', 'enterprise'],
    });

    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/meta/bases/appAAA/tables')) {
        return jsonResponse({ tables: [tableProspects] });
      }
      if (req.url.includes('/meta/bases')) {
        return jsonResponse({ bases: [baseA] });
      }
      return jsonResponse({ records: [record] });
    });

    const spec = createAirtableSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({ allowlist: wildcardAllowlist });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(enqueued).toHaveLength(1);
    const chunk = enqueued[0]!;
    expect(chunk.kind).toBe('airtable-record');
    expect(chunk.provider).toBe('airtable');
    expect(chunk.externalId).toBe('appAAA:tblProspects:rec1');
    expect(chunk.sourceArtifactId).toBe('airtable-record:appAAA:tblProspects:rec1');
    expect(chunk.content).toContain('[Customers · Prospects] Acme Corp');
    expect(chunk.content).toContain('Notes: Large enterprise lead.');
    expect(chunk.content).toContain('Tags: hot, enterprise');
    expect(chunk.aclSubjects).toEqual(['org:org-1', 'airtable:base:appAAA', 'airtable:org']);
    expect(chunk.metadata['baseId']).toBe('appAAA');
    expect(chunk.metadata['tableName']).toBe('Prospects');
    expect(chunk.metadata['url']).toBe('https://airtable.com/appAAA/tblProspects/rec1');
  });

  it('skips a base that returns 403 on schema fetch without aborting other bases', async () => {
    const baseA = makeBase('appAAA', 'Visible');
    const baseB = makeBase('appBBB', 'Forbidden');
    const tableA = makeTable({ id: 'tblA', name: 'A' });
    const recA = makeRecord('rec1', { Name: 'one' });

    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/meta/bases') || req.url.includes('/meta/bases?')) {
        return jsonResponse({ bases: [baseA, baseB] });
      }
      if (req.url.endsWith('/meta/bases/appAAA/tables')) {
        return jsonResponse({ tables: [tableA] });
      }
      if (req.url.endsWith('/meta/bases/appBBB/tables')) {
        return jsonResponse({ error: 'forbidden' }, { status: 403 });
      }
      if (req.url.includes('/appAAA/tblA')) {
        return jsonResponse({ records: [recA] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createAirtableSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({ allowlist: wildcardAllowlist });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(result.artifactCount).toBe(1);
    expect(enqueued[0]!.metadata['baseId']).toBe('appAAA');
  });
});

describe('Airtable sync (incremental)', () => {
  it('passes a LAST_MODIFIED_TIME formula filter on subsequent syncs', async () => {
    const baseA = makeBase('appAAA', 'Customers');
    const tableA = makeTable({ id: 'tblA', name: 'A' });

    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/meta/bases') || req.url.includes('/meta/bases?')) {
        return jsonResponse({ bases: [baseA] });
      }
      if (req.url.endsWith('/meta/bases/appAAA/tables')) {
        return jsonResponse({ tables: [tableA] });
      }
      if (req.url.includes('/appAAA/tblA')) {
        return jsonResponse({ records: [] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createAirtableSpec({ fetchImpl });
    const { stores } = makeStores({
      allowlist: wildcardAllowlist,
      cursors: {
        records: {
          lastModifiedPerTable: { 'appAAA:tblA': '2026-05-01T10:00:00.000Z' },
        },
      },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const recordsCall = calls.find((c) => c.url.includes('/appAAA/tblA'))!;
    expect(recordsCall.url).toContain('filterByFormula=');
    expect(decodeURIComponent(recordsCall.url)).toContain('LAST_MODIFIED_TIME()');
    expect(decodeURIComponent(recordsCall.url)).toContain(
      'DATETIME_PARSE("2026-05-01T10:00:00.000Z")',
    );
  });
});

describe('Airtable testConnection', () => {
  it('returns the user id and email from the whoami endpoint', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        id: 'usrXYZ',
        email: 'alice@example.com',
        scopes: ['data.records:read', 'schema.bases:read', 'user.email:read'],
      }),
    );
    const spec = createAirtableSpec({ fetchImpl });
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'pat_token' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({
      api,
      tokens: { accessToken: 'pat_token' },
    });
    expect(result.externalId).toBe('usrXYZ');
    expect(result.name).toBe('alice@example.com');
  });

  it('maps a 401 to HOLO_AIRTABLE_TOKEN_INVALID', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ error: 'unauthorized' }, { status: 401 }),
    );
    const spec = createAirtableSpec({ fetchImpl });
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'bad_token' },
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      spec.testConnection({ api, tokens: { accessToken: 'bad_token' } }),
    ).rejects.toMatchObject({ code: 'HOLO_AIRTABLE_TOKEN_INVALID' });
  });
});
