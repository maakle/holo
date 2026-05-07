import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createHubspotSpec } from '../src/hubspot/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: { existingHashes?: string[]; cursors?: Record<string, unknown> }): {
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
        return { accessToken: 'hs_service_key' };
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
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    let body: unknown = null;
    if (typeof init.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      body,
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

/**
 * A minimal "no-engagements" responder used by tests that don't care about
 * activity-timeline plumbing — every association list returns empty.
 */
function emptyEngagementsResponder(req: CapturedRequest): Response | null {
  if (req.url.includes('/associations/')) {
    return jsonResponse({ results: [], paging: undefined });
  }
  if (req.url.endsWith('/batch/read')) {
    return jsonResponse({ results: [] });
  }
  return null;
}

describe('createHubspotSpec', () => {
  it('declares 3 resources (contacts, deals, companies) in order', () => {
    const spec = createHubspotSpec();
    expect(spec.id).toBe('hubspot');
    expect(spec.resources).toHaveLength(3);
    expect(spec.resources.map((r) => r.id)).toEqual(['contacts', 'deals', 'companies']);
    expect(spec.auth.kind).toBe('apiKey');
  });

  it('has the documented http base url', () => {
    expect(createHubspotSpec().http?.baseUrl).toBe('https://api.hubapi.com');
  });
});

describe('HubSpot sync — full sweep with no engagements', () => {
  it('iterates all three resources and emits one chunk per record kind', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const empty = emptyEngagementsResponder(req);
      if (empty) return empty;
      // Paged GET listing per object type — return 1 record each.
      if (req.url.includes('/crm/v3/objects/contacts?')) {
        return jsonResponse({
          results: [
            {
              id: 'c1',
              properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.com' },
              createdAt: '2026-04-01T00:00:00Z',
              updatedAt: '2026-05-01T10:00:00Z',
            },
          ],
        });
      }
      if (req.url.includes('/crm/v3/objects/deals?')) {
        return jsonResponse({
          results: [
            {
              id: 'd1',
              properties: { dealname: 'Acme Q2', amount: '50000' },
              createdAt: '2026-04-01T00:00:00Z',
              updatedAt: '2026-05-02T10:00:00Z',
            },
          ],
        });
      }
      if (req.url.includes('/crm/v3/objects/companies?')) {
        return jsonResponse({
          results: [
            {
              id: 'co1',
              properties: { name: 'Acme', domain: 'acme.example' },
              createdAt: '2026-04-01T00:00:00Z',
              updatedAt: '2026-05-03T10:00:00Z',
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createHubspotSpec();
    const { stores, enqueued, savedCursors } = makeStores();
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(3);
    const kinds = new Set(enqueued.map((c) => c.kind));
    expect(kinds.has('hubspot-contact')).toBe(true);
    expect(kinds.has('hubspot-deal')).toBe(true);
    expect(kinds.has('hubspot-company')).toBe(true);

    // Each record produces an artifact id with the legacy prefix.
    const artifactIds = new Set(enqueued.map((c) => c.sourceArtifactId));
    expect(artifactIds.has('hubspot-contact:c1')).toBe(true);
    expect(artifactIds.has('hubspot-deal:d1')).toBe(true);
    expect(artifactIds.has('hubspot-company:co1')).toBe(true);

    // Per-resource cursors saved independently (not a composite blob).
    const byResource = new Map(savedCursors.map((s) => [s.resourceId, s.cursor]));
    expect(byResource.get('contacts')).toEqual({ updatedAt: '2026-05-01T10:00:00Z' });
    expect(byResource.get('deals')).toEqual({ updatedAt: '2026-05-02T10:00:00Z' });
    expect(byResource.get('companies')).toEqual({ updatedAt: '2026-05-03T10:00:00Z' });

    // The crm property list is sent as a multi-value query param. (Single
    // GET per object type, since no cursor was supplied.)
    const contactsList = calls.find(
      (c) => c.url.includes('/crm/v3/objects/contacts?') && c.method === 'GET',
    );
    expect(contactsList).toBeDefined();
    expect(contactsList!.url).toContain('properties=firstname');
    expect(contactsList!.url).toContain('properties=email');
  });
});

describe('HubSpot sync — incremental switches to /search with updatedAfter filter', () => {
  it('uses the search endpoint when a per-resource cursor is set', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const empty = emptyEngagementsResponder(req);
      if (empty) return empty;
      // Search POST returns the same shape but exercised conditionally.
      if (req.url.endsWith('/crm/v3/objects/contacts/search')) {
        return jsonResponse({
          results: [
            {
              id: 'c2',
              properties: { firstname: 'Grace', lastname: 'Hopper' },
              createdAt: '2026-05-04T00:00:00Z',
              updatedAt: '2026-05-04T10:00:00Z',
            },
          ],
        });
      }
      return jsonResponse({ results: [] });
    });

    const spec = createHubspotSpec();
    const { stores } = makeStores({
      cursors: { contacts: { updatedAt: '2026-05-01T00:00:00Z' } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const search = calls.find(
      (c) =>
        c.url.endsWith('/crm/v3/objects/contacts/search') && c.method === 'POST',
    );
    expect(search).toBeDefined();
    expect(search!.body).toMatchObject({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'lastmodifieddate',
              operator: 'GTE',
              value: '2026-05-01T00:00:00Z',
            },
          ],
        },
      ],
    });
  });

  it('uses hs_lastmodifieddate (not lastmodifieddate) for deals and companies', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const empty = emptyEngagementsResponder(req);
      if (empty) return empty;
      return jsonResponse({ results: [] });
    });
    const spec = createHubspotSpec();
    const { stores } = makeStores({
      cursors: {
        deals: { updatedAt: '2026-05-01T00:00:00Z' },
        companies: { updatedAt: '2026-05-01T00:00:00Z' },
      },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const dealsSearch = calls.find((c) =>
      c.url.endsWith('/crm/v3/objects/deals/search'),
    );
    const companiesSearch = calls.find((c) =>
      c.url.endsWith('/crm/v3/objects/companies/search'),
    );
    expect(
      (dealsSearch!.body as { filterGroups: { filters: Array<{ propertyName: string }> }[] })
        .filterGroups[0]!.filters[0]!.propertyName,
    ).toBe('hs_lastmodifieddate');
    expect(
      (companiesSearch!.body as { filterGroups: { filters: Array<{ propertyName: string }> }[] })
        .filterGroups[0]!.filters[0]!.propertyName,
    ).toBe('hs_lastmodifieddate');
  });
});

describe('HubSpot sync — engagements', () => {
  it('fetches engagements via associations + batch-read and emits hubspot-engagement chunks', async () => {
    const { fetchImpl } = makeFetch((req) => {
      // Contact list — one record.
      if (req.url.includes('/crm/v3/objects/contacts?')) {
        return jsonResponse({
          results: [
            {
              id: 'c1',
              properties: { firstname: 'Ada' },
              createdAt: '2026-04-01T00:00:00Z',
              updatedAt: '2026-05-01T10:00:00Z',
            },
          ],
        });
      }
      // No deals / companies.
      if (req.url.includes('/crm/v3/objects/deals?')) {
        return jsonResponse({ results: [] });
      }
      if (req.url.includes('/crm/v3/objects/companies?')) {
        return jsonResponse({ results: [] });
      }
      // Associations: one note id, no others.
      if (req.url.includes('/associations/notes')) {
        return jsonResponse({
          results: [{ toObjectId: 'n1' }],
          paging: undefined,
        });
      }
      if (req.url.includes('/associations/')) {
        return jsonResponse({ results: [] });
      }
      // Batch read for notes.
      if (req.url.endsWith('/crm/v3/objects/notes/batch/read')) {
        return jsonResponse({
          results: [
            {
              id: 'n1',
              properties: {
                hs_note_body: 'first call summary',
                hs_timestamp: '2026-04-30T12:00:00Z',
                hubspot_owner_id: 'u-7',
              },
              createdAt: '2026-04-30T12:00:00Z',
              updatedAt: '2026-04-30T12:00:00Z',
            },
          ],
        });
      }
      // No other engagement types.
      if (req.url.endsWith('/batch/read')) {
        return jsonResponse({ results: [] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createHubspotSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const engagementChunks = enqueued.filter((c) => c.kind === 'hubspot-engagement');
    expect(engagementChunks.length).toBeGreaterThan(0);
    expect(engagementChunks[0]!.sourceArtifactId).toBe('hubspot-contact:c1');
  });

  it('continues indexing the record when its engagements lookup throws', async () => {
    let assocAttempts = 0;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/crm/v3/objects/contacts?')) {
        return jsonResponse({
          results: [
            {
              id: 'c1',
              properties: { firstname: 'Ada', email: 'ada@e.com' },
              createdAt: '2026-04-01T00:00:00Z',
              updatedAt: '2026-05-01T10:00:00Z',
            },
          ],
        });
      }
      if (req.url.includes('/crm/v3/objects/deals?') || req.url.includes('/crm/v3/objects/companies?')) {
        return jsonResponse({ results: [] });
      }
      if (req.url.includes('/associations/')) {
        assocAttempts += 1;
        return jsonResponse({}, { status: 500 });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createHubspotSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(assocAttempts).toBeGreaterThan(0);
    // Contact still indexed via its own properties.
    const contactChunks = enqueued.filter((c) => c.kind === 'hubspot-contact');
    expect(contactChunks.length).toBeGreaterThan(0);
  });
});

describe('HubSpot testConnection', () => {
  it('returns hub id and account-type-derived name', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ portalId: 1234, accountType: 'STANDARD', timeZone: 'America/Los_Angeles' }),
    );
    const spec = createHubspotSpec();
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'k' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 'k' } });
    expect(result.externalId).toBe('1234');
    expect(result.name).toBe('Hub 1234 (STANDARD)');
  });
});
